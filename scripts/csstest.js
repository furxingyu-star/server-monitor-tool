const { app, BrowserWindow } = require('electron');
const path=require('path');
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:600,height:400,show:false,webPreferences:{nodeIntegration:false}});
  const html='<!doctype html><html><head><style>' +
    'body{margin:0;background:#123}' +
    '.a{--lens: url(#lg-lens-2); backdrop-filter: blur(2px) saturate(140%) var(--lens, none); width:100px;height:100px;background:#345}' +
    '.b{backdrop-filter: blur(2px) var(--lens); width:50px;height:50px;background:#456}' +
    '</style></head><body><div class="a"></div><div class="b"></div></body></html>';
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
  const out=await win.webContents.executeJavaScript(`(()=>{
    const a=document.querySelector('.a'), b=document.querySelector('.b');
    return {supported: CSS.supports('backdrop-filter','url(#x)'),
      a: getComputedStyle(a).backdropFilter,
      b: getComputedStyle(b).backdropFilter};
  })()`);
  console.log('CSSTEST '+JSON.stringify(out));
  app.quit();
});