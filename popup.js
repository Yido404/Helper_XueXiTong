'use strict';
let tab;
const $ = id => document.getElementById(id);
async function request(cmd, extra = {}) {
  const response = await chrome.runtime.sendMessage({ cf: true, cmd, tabId: tab.id, ...extra });
  if (!response?.ok) throw new Error(response?.error || '连接课程页失败');
  return response.result;
}
function render(state) {
  $('headline').textContent = state.running ? '正在运行' : '已停止';
  $('detail').textContent = state.status || '点击开始当前课程';
  $('dot').classList.toggle('on', state.running);
  $('muted').checked = state.muted;
  $('logs').replaceChildren(...(state.logs || []).map(item => {
    const li = document.createElement('li');
    li.textContent = `${new Date(item.time).toLocaleTimeString('zh-CN', { hour12: false })} ${item.text}`;
    return li;
  }));
}
function fail(error) { $('headline').textContent = '需要操作'; $('detail').textContent = error.message; }
async function ensureInjected() {
  await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['core.js', 'agent.js'] });
}
async function run(cmd, extra) {
  try { await ensureInjected(); render(await request(cmd, extra)); } catch (error) { fail(error); }
}
$('start').addEventListener('click', () => run('start', { muted: $('muted').checked }));
$('stop').addEventListener('click', () => request('stop').then(render).catch(fail));
$('clear').addEventListener('click', () => run('clear'));
for (const button of document.querySelectorAll('[data-role]')) {
  button.addEventListener('click', async () => {
    try { await ensureInjected(); await request('pick', { role: button.dataset.role }); window.close(); }
    catch (error) { fail(error); }
  });
}
$('authorize').addEventListener('click', async () => {
  try {
    const origin = `${new URL(tab.url).origin}/*`;
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) throw new Error('未授权，插件未启用');
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    if (!scripts.some(script => script.matches.includes(origin))) {
      const id = `site-${Date.now()}`;
      await chrome.scripting.registerContentScripts([{ id, matches: [origin], js: ['core.js', 'agent.js'], allFrames: true, matchOriginAsFallback: true, runAt: 'document_idle', persistAcrossSessions: true }]);
    }
    await ensureInjected(); $('authorize').hidden = true;
    $('start').disabled = false;
    for (const button of document.querySelectorAll('[data-role]')) button.disabled = false;
    render(await request('get'));
  } catch (error) { fail(error); }
});
(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error('请在普通 HTTP／HTTPS 课程网页中打开插件');
  const granted = await chrome.permissions.contains({ origins: [`${new URL(tab.url).origin}/*`] });
  $('authorize').hidden = granted;
  if (!granted) {
    $('start').disabled = true;
    for (const button of document.querySelectorAll('[data-role]')) button.disabled = true;
    $('headline').textContent = '当前网站尚未启用'; $('detail').textContent = '点击“启用当前网站”，然后标记页面控件'; return;
  }
  await ensureInjected(); render(await request('get'));
})().catch(fail);
