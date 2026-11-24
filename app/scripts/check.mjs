const base=process.env.SITE_URL||'http://localhost:3000';
const r=await fetch(base.replace(/\/$/,'')+'/api/health');
const body=await r.json().catch(()=>({}));
console.log(JSON.stringify({status:r.status,...body},null,2));
if(!r.ok)process.exit(1);
