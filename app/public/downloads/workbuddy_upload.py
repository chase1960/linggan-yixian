#!/usr/bin/env python3
"""Standard-library uploader. Config is downloaded from the signed-in knowledge hub."""
import argparse,base64,datetime,hashlib,json,pathlib,sys,time,urllib.error,urllib.parse,urllib.request,uuid,os

def atomic_json(path,value):
    temp=path.with_name(path.name+'.tmp');temp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8');os.replace(temp,path)
def packet_for(directory):
    manifest_path=directory/'manifest.json'
    meta=json.loads(manifest_path.read_text(encoding='utf-8-sig')) if manifest_path.exists() else {}
    batch_id=meta.get('batch_id',directory.name)
    files={};entries=[]
    paths=[directory/'messages.jsonl',directory/'analysis.jsonl']
    if (directory/'attachments').is_dir():paths+=sorted(p for p in (directory/'attachments').iterdir() if p.is_file())
    total=0
    for path in paths:
        relative=path.relative_to(directory).as_posix();raw=path.read_bytes();total+=len(raw)
        if total>8_000_000 or len(raw)>4_000_000:raise ValueError('Batch exceeds size limit; split before upload.')
        files[relative]={'encoding':'base64' if relative.startswith('attachments/') else 'utf8','content':base64.b64encode(raw).decode() if relative.startswith('attachments/') else raw.decode('utf-8-sig')}
        wire=raw if relative.startswith('attachments/') else files[relative]['content'].encode('utf-8')
        entries.append({'path':relative,'sha256':hashlib.sha256(wire).hexdigest(),'bytes':len(wire)})
    manifest={'schema_version':1,'batch_id':batch_id,'producer':meta.get('producer','workbuddy'),'captured_at':meta.get('captured_at',datetime.datetime.now(datetime.timezone.utc).isoformat()),'status':meta.get('status','success'),'files':entries}
    # Preserve unknown scope information without changing canonical protocol keys.
    for key in ['source_scope','missing','source_kind']:
        if key in meta:manifest[key]=meta[key]
    return {'manifest':manifest,'files':files}
def request(config,path,method='GET',packet=None):
    origin=config['site_url'].rstrip('/');url=urllib.parse.urlparse(origin)
    if url.scheme!='https' or url.path not in ('','/') or url.query or url.fragment:raise ValueError('Config requires one HTTPS origin.')
    headers={'Authorization':'Bearer '+config['token'],'Accept':'application/json'}
    if config.get('site_access_token'):headers['OAI-Sites-Authorization']='Bearer '+config['site_access_token']
    if packet is not None:headers['Content-Type']='application/json'
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):raise ValueError('Refusing redirect with credentials.')
    req=urllib.request.Request(origin+path,method=method,headers=headers,data=json.dumps(packet,ensure_ascii=False).encode() if packet is not None else None)
    with urllib.request.build_opener(NoRedirect).open(req,timeout=45) as response:return json.load(response)
def upload_root(root,config):
    state_path=root/'sync-state.json';state=json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else {'schema_version':1,'batches':{}}
    failures=0
    for directory in sorted((root/'batches').iterdir()):
        if not directory.is_dir():continue
        try:
            pending=directory/'upload-packet.json'
            # Reuse identical wire bytes after failure; never change timestamps on retries.
            if pending.exists():
                packet=json.loads(pending.read_text(encoding='utf-8'))
                if packet_for(directory)['files']!=packet['files']:raise ValueError('Source files changed; create a new batch id.')
            else:packet=packet_for(directory);atomic_json(pending,packet)
            batch_id=packet['manifest']['batch_id'];wire_hash=hashlib.sha256(json.dumps(packet,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
            old=state['batches'].get(batch_id,{})
            if old.get('status')=='synced':
                if old.get('local_hash')!=wire_hash:raise ValueError('A synced batch changed; create a new batch id.')
                continue
            last_error=None
            for attempt in range(3):
                try:
                    receipt=request(config,'/api/imports','POST',packet)
                    verified=request(config,'/api/imports/'+urllib.parse.quote(batch_id,safe=''))
                    if verified.get('status')!='committed' or verified.get('sha256')!=receipt.get('sha256'):raise ValueError('Receipt did not match committed batch.')
                    state['batches'][batch_id]={'status':'synced','local_hash':wire_hash,'receipt':verified,'synced_at':datetime.datetime.now(datetime.timezone.utc).isoformat()};atomic_json(state_path,state);atomic_json(directory/'receipt.json',verified)
                    print(json.dumps({'batch_id':batch_id,'status':'synced','items':verified.get('items',0)},ensure_ascii=False));last_error=None;break
                except urllib.error.HTTPError as error:
                    last_error='HTTP '+str(error.code)
                    if error.code<500 and error.code!=429:break
                except Exception as error:last_error=type(error).__name__
                if attempt<2:time.sleep(2**attempt)
            if last_error:raise ValueError(last_error)
        except Exception as error:
            failures+=1
            if state['batches'].get(directory.name,{}).get('status')=='synced':
                print(json.dumps({'batch_id':directory.name,'status':'source_changed_after_sync'},ensure_ascii=False),file=sys.stderr);continue
            state['batches'][directory.name]={'status':'pending','error_type':type(error).__name__,'last_attempt':datetime.datetime.now(datetime.timezone.utc).isoformat()};atomic_json(state_path,state)
            print(json.dumps({'batch_id':directory.name,'status':'pending','error_type':type(error).__name__},ensure_ascii=False),file=sys.stderr)
    return failures
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',required=True,type=pathlib.Path);parser.add_argument('--config',required=True,type=pathlib.Path);args=parser.parse_args()
    config=json.loads(args.config.read_text(encoding='utf-8-sig'))
    args.root.mkdir(parents=True,exist_ok=True);(args.root/'batches').mkdir(exist_ok=True)
    # Single uploader per root; a crash leaves a visible lock requiring inspection.
    lock=args.root/'.upload.lock'
    try:fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
    except FileExistsError:raise SystemExit('Another upload or a stale lock exists. Inspect before removing .upload.lock.')
    try:os.close(fd);sys.exit(1 if upload_root(args.root,config) else 0)
    finally:lock.unlink(missing_ok=True)
