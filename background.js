importScripts('core.js');
const C = CourseFlowCore;
const frames = new Map();
const locks = new Map();
const cache = new Map();
const keyFor = id => `run:${id}`;
const defaults = () => ({ running: false, status: '已停止', scope: '', page: '', settleUntil: 0, lastAction: 0, switches: 0, skipped: 0, muted: true, logs: [] });
async function load(id) {
  if (!cache.has(id)) cache.set(id, (await chrome.storage.session.get(keyFor(id)))[keyFor(id)] || defaults());
  return cache.get(id);
}
async function save(id, state) {
  await chrome.storage.session.set({ [keyFor(id)]: state });
}
async function publish(id, state) {
  await chrome.tabs.sendMessage(id, { cf: true, cmd: 'status', state }, { frameId: 0 }).catch(() => {});
}
function log(state, text) {
  state.logs = [{ time: Date.now(), text }, ...state.logs].slice(0, 30);
}
async function enableAgents(id, enabled) {
  await chrome.tabs.sendMessage(id, { cf: true, cmd: 'enabled', enabled }).catch(() => {});
}
async function processReport(id, snapshot, sender) {
  const state = await load(id);
  if (sender.frameId !== 0) return { enabled: state.running };
  // Collect only currently attached documents. A removed iframe must never mark the new lesson complete.
  const live = await chrome.scripting.executeScript({
    target: { tabId: id, allFrames: true },
    func: () => globalThis.__courseFlowAPI?.snapshot() || null
  });
  const entries = new Map();
  const now = Date.now();
  for (const item of live) if (item.result) entries.set(item.frameId, { ...item.result, frameId: item.frameId, documentId: item.documentId, seenAt: now });
  snapshot = entries.get(0) || snapshot;
  const signature = [...entries.values()].map(f => `${f.page}|${f.heading || ''}|${f.video?.source || ''}`).sort().join('\n');
  if (sender.frameId === 0 && snapshot.page !== state.page) {
    state.page = snapshot.page;
    state.settleUntil = now + 4500;
    state.pendingNavigation = null;
    state.progressAt = now;
    state.positions = '';
    await save(id, state);
  }
  frames.set(id, entries);
  if (!state.running) return { enabled: false };
  if (state.pendingNavigation && signature !== state.pendingNavigation.signature) {
    state.pendingNavigation = null;
    state.settleUntil = now + 4500;
    state.progressAt = now;
    await save(id, state);
  }
  if (state.pendingNavigation && now - state.pendingNavigation.at > 18000) {
    state.running = false;
    state.status = '点击下一节后没有检测到页面变化，请检查页面或重新标记';
    state.pendingNavigation = null;
    log(state, state.status); await save(id, state); await enableAgents(id, false); await publish(id, state);
    return { enabled: false };
  }
  const decision = C.decide(state, [...entries.values()], now);
  if (state.pendingNavigation && !['confirmNext', 'stop'].includes(decision.type)) return { enabled: true };
  const positions = [...entries.values()].filter(f => f.video).map(f => `${f.video.source}:${f.video.time}`).sort().join('|');
  if (positions && positions !== state.positions) { state.positions = positions; state.progressAt = now; }
  state.progressAt ||= now;
  if (now - state.progressAt > 180000) {
    state.running = false; state.status = '三分钟未检测到播放进展，请检查页面或手动标记控件';
    log(state, state.status); await save(id, state); await enableAgents(id, false); await publish(id, state);
    return { enabled: false };
  }
  state.status = decision.reason;
  if (decision.type === 'stop') {
    state.running = false;
    state.pendingNavigation = null;
    log(state, decision.reason);
    await save(id, state);
    await enableAgents(id, false);
  } else if (decision.type === 'confirmNext' || ['play', 'next', 'dismiss'].includes(decision.type) && now - state.lastAction > (decision.type === 'play' ? 6000 : 12000)) {
    const frame = entries.get(decision.frameId);
    state.lastAction = now;
    // Persist before acting, so worker suspension cannot cause an immediate duplicate click.
    if (decision.type !== 'play') state.settleUntil = now + 12000;
    await save(id, state);
    if (decision.type === 'next') { state.pendingNavigation = { at: now, signature }; await save(id, state); }
    if (decision.type === 'confirmNext') {
      state.pendingNavigation = { ...state.pendingNavigation, at: now, signature, confirmedAt: now };
      state.progressAt = now;
      await save(id, state);
    }
    const result = await chrome.tabs.sendMessage(id, { cf: true, cmd: 'act', action: decision.type, page: frame.page, muted: state.muted, hasQuiz: [...entries.values()].some(f => f.quiz), allowConfirmNext: decision.type === 'confirmNext' }, { documentId: frame.documentId });
    if (result?.ok) {
      if (decision.type === 'next') {
        state.switches++;
        if ([...entries.values()].some(f => f.quiz)) state.skipped++;
        // Drop old iframe reports immediately, before the site's asynchronous navigation.
        frames.set(id, new Map());
      }
      log(state, decision.reason);
    } else {
      state.running = false;
      state.status = result?.reason || '控件未响应，请检查页面或重新标记';
      state.pendingNavigation = null;
      log(state, state.status);
      await enableAgents(id, false);
    }
    await save(id, state);
  }
  await publish(id, state);
  return { enabled: state.running };
}
function serialize(id, operation) {
  const task = (locks.get(id) || Promise.resolve()).catch(() => {}).then(operation);
  locks.set(id, task);
  task.finally(() => { if (locks.get(id) === task) locks.delete(id); }).catch(() => {});
  return task;
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!message?.cf || sender.id !== chrome.runtime.id) return;
  const extensionPage = sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`);
  const fromPage = Boolean(sender.tab) && !extensionPage;
  const id = fromPage ? sender.tab.id : message.tabId;
  if (!Number.isInteger(id)) return;
  const allowedPage = ['hello', 'report', 'picked', 'panelRun', 'panelStop'];
  if (fromPage && !allowedPage.includes(message.cmd)) return;
  // Only the top frame may control a run. Child frames report and mark their own controls.
  if (fromPage && ['panelRun', 'panelStop'].includes(message.cmd) && sender.frameId !== 0) return;
  serialize(id, async () => {
    const state = await load(id);
    if (message.cmd === 'hello') return { enabled: state.running, state };
    if (message.cmd === 'report') return processReport(id, message.snapshot, sender);
    if (message.cmd === 'get') return state;
    if (message.cmd === 'stop' || message.cmd === 'panelStop') {
      state.running = false; state.status = '已停止'; log(state, '手动停止');
      await save(id, state); await enableAgents(id, false); await publish(id, state); return state;
    }
    if (message.cmd === 'start' || message.cmd === 'panelRun') {
      const top = await chrome.tabs.sendMessage(id, { cf: true, cmd: 'snapshot' }, { frameId: 0 });
      if (!top?.url || !/^https?:/.test(top.url)) throw new Error('请先打开并授权课程网页');
      state.running = true; state.scope = C.scopeKey(top.url); state.page = top.page;
      state.pendingNavigation = null;
      state.muted = message.muted ?? state.muted; state.lastAction = 0; state.settleUntil = Date.now() + 4500;
      state.status = '正在识别课程'; state.progressAt = Date.now(); state.positions = ''; log(state, '开始当前课程');
      frames.set(id, new Map()); await save(id, state); await enableAgents(id, true); await publish(id, state); return state;
    }
    if (message.cmd === 'pick') {
      state.running = false; state.status = '标记模式：点击目标，Esc 取消';
      await save(id, state); await enableAgents(id, false); await publish(id, state);
      await chrome.tabs.sendMessage(id, { cf: true, cmd: 'pick', role: message.role }); return state;
    }
    if (message.cmd === 'picked') {
      await chrome.tabs.sendMessage(id, { cf: true, cmd: 'cancelPick' }).catch(() => {});
      state.status = message.cancelled ? '已取消标记' : `已保存${message.label}，点击开始继续`;
      await save(id, state); await publish(id, state); return state;
    }
    if (message.cmd === 'clear') {
      state.running = false; state.status = '已清除当前页面及其iframe的标记';
      await save(id, state); await enableAgents(id, false);
      await chrome.tabs.sendMessage(id, { cf: true, cmd: 'clear' }); await publish(id, state); return state;
    }
    throw new Error('未知操作');
  }).then(result => reply({ ok: true, result })).catch(async error => {
    const state = await load(id);
    state.running = false; state.status = error.message || '页面连接中断，请刷新课程页面';
    await save(id, state).catch(() => {}); await publish(id, state);
    reply({ ok: false, error: state.status });
  });
  return true;
});
chrome.tabs.onRemoved.addListener(id => {
  frames.delete(id); cache.delete(id); locks.delete(id); chrome.storage.session.remove(keyFor(id));
});
