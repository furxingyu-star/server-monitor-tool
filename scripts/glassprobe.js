const { app, BrowserWindow } = require('electron');
const fs=require('fs'), path=require('path');
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:900,height:640,show:true,backgroundColor:'#101828'});
  await win.loadFile(path.join(__dirname,'glassprobe2.html'));
  await new Promise(r=>setTimeout(r,1800));
  const img=await win.webContents.capturePage();
  fs.writeFileSync(path.join(process.cwd(),'shots-probe-lens.png'),img.toPNG());
  app.quit();
});