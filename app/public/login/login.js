const form=document.getElementById('login-form'),msg=document.getElementById('msg');
form.addEventListener('submit',async ev=>{
 ev.preventDefault();
 const button=form.querySelector('button');
 button.disabled=true;msg.textContent='';
 try{
  const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:document.getElementById('code').value})});
  const body=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(body.message||'登录没有完成。');
  location.replace('/');
 }catch(err){msg.textContent=err.message;button.disabled=false;}
});
