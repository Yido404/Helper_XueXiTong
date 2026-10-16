(() => {
  'use strict';
  if (globalThis.__courseFlowAgent) return;
  globalThis.__courseFlowAgent = true;
  const C = CourseFlowCore;
  const topFrame = window === window.top;
  const labels = { video: '播放器', play: '播放按钮', next: '下一节', done: '完成提示', quiz: '题目区域', skip: '跳过／关闭题目按钮' };
  const profileKey = `marks:${location.origin}${location.pathname}`;
  let profile = {}, enabled = false, picking = '', hovered, panel, statusText, toggleButton;
  let sending = false, lastPage = '', videoProgress = { node: null, time: -1, at: Date.now() };
  const owned = node => node?.closest?.('[data-course-flow-ui]');
  const visible = node => {
    if (!node?.isConnected || owned(node)) return false;
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && !node.closest('[hidden],[aria-hidden="true"]') && node.getClientRects().length > 0;
  };
  const text = node => C.tidy(`${node?.textContent || ''} ${node?.getAttribute?.('aria-label') || ''} ${node?.getAttribute?.('title') || ''}`);
  const send = message => chrome.runtime.sendMessage({ cf: true, ...message });
  function query(selector, scope = document) {
    try { return [...scope.querySelectorAll(selector)].filter(visible); } catch { return []; }
  }
  function marked(role) {
    const mark = profile[role];
    if (!mark) return null;
    const matches = query(mark.selector);
    if (matches.length === 1 && (!mark.text || text(matches[0]).includes(mark.text))) return matches[0];
    // Match an exact text label if a harmless site layout update invalidated the CSS path.
    if (mark.text && ['next', 'play', 'skip'].includes(role)) {
      const byText = query('button,a,[role="button"],span,div').filter(n => text(n) === mark.text && n.children.length < 3);
      if (byText.length === 1) return byText[0];
    }
    return null;
  }
  function nextButton() {
    const custom = marked('next');
    if (custom && C.safeNavigationText(text(custom))) return usable(custom) ? custom : null;
    const known = query('#prevNextFocusNext, [aria-label="下一节"], [aria-label="下一课"]');
    if (known.length) return usable(known[0]) ? known[0] : null;
    return query('button,a,[role="button"]').find(n => usable(n) && /^下一(?:节|课|章节|个视频)\s*[›»>→]?$/.test(C.tidy(n.textContent))) || null;
  }
  function usable(node) {
    const submitsForm = Boolean(node.form) && (node.matches('input[type="submit"],input[type="image"]') || node.matches('button') && node.type === 'submit');
    return !submitsForm && !node.disabled && node.getAttribute('aria-disabled') !== 'true' && !/(^|\s)(disabled|disable)(\s|$)/.test(node.className || '');
  }
  function incompleteNavigationButton() {
    const compact = node => C.tidy(node.textContent).replace(/\s/g, '');
    const prompt = /^当前章节(?:还)?有任务点未完成[，,]?是否去完成[?？]?$/;
    const dialogs = '[role="dialog"],[role="alertdialog"],dialog,.layui-layer,.ui-dialog,.modal,.popBox,.popDiv,.el-message-box,.ant-modal-content';
    const controls = 'button,a,[role="button"],input[type="button"],input[type="submit"],[onclick]';
    const label = node => C.tidy(node.matches('input') ? node.value : node.textContent).replace(/\s/g, '');
    const matches = new Set();
    for (const message of query('p,span,div,section,td').filter(n => prompt.test(compact(n)))) {
      const boundary = message.closest(dialogs);
      // Find the smallest prompt container with both choices, never the page-wide next control.
      for (let box = message.parentElement, depth = 0; box && box !== document.body && box !== document.documentElement && depth < 6; box = box.parentElement, depth++) {
        if (!visible(box) || compact(box).length > 320) break;
        const buttons = query(controls, box);
        const next = buttons.filter(n => label(n) === '下一节' && usable(n));
        if (next.length === 1 && buttons.some(n => label(n) === '去学习')) {
          matches.add(next[0]);
          break;
        }
        if (box === boundary) break;
      }
    }
    return matches.size === 1 ? [...matches][0] : null;
  }
  function videoNode() {
    const custom = marked('video');
    if (custom) return custom.matches('video') ? custom : custom.querySelector('video');
    const videos = query('video');
    return videos.filter(v => !v.ended).sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || videos[0] || null;
  }
  function playButton() {
    return marked('play') || query('.vjs-big-play-button, button[title="播放视频"], button[aria-label="播放视频"], button[aria-label="播放"], button[title="播放"]')[0] || null;
  }
  function doneIndicator() {
    const custom = marked('done');
    if (custom && C.completeText(text(custom), profile.done.expected || '')) return true;
    const courseCard = document.querySelector('#pageDiv');
    const scope = courseCard || document;
    if (query('.ans-job-finished', scope).length) return true;
    const candidates = query('[title*="任务点"], [aria-label*="任务点"], .ans-job-icon', scope);
    if (candidates.some(n => C.completeText(text(n)))) return true;
    return Boolean(courseCard) && query('span,div', scope).slice(0, 2000).some(n => n.children.length === 0 && C.completeText(n.textContent));
  }
  function questionPresent() {
    const custom = marked('quiz');
    if (custom && !custom.matches('video') && !custom.querySelector('video,iframe[src*="video"]')) return true;
    if (/\/work\/(?:doHomeWork|selectWorkQuestion)/i.test(location.pathname)) return true;
    if (query('#RightCon').some(n => /题量\s*[:：]|【(?:单选|多选|判断)题】/.test(n.textContent))) return true;
    if (query('.ans-videoquiz, .ans-videoquiz-opt, .vjs-quiz, [data-video-quiz]').length) return true;
    return query('[role="dialog"]').some(n => /单选题|多选题|判断题|提交答案/.test(n.textContent));
  }
  function blocker() {
    if (query('.geetest_panel, .yidun_panel, iframe[src*="captcha"], [data-captcha]').length) return '遇到验证码，已停止，请手动处理';
    if (query('[role="dialog"]').some(n => /人脸识别|安全验证|重新登录|登录已过期/.test(n.textContent))) return '页面要求身份验证或重新登录，请手动处理';
    return '';
  }
  const outsideLesson = 'aside,nav,header,footer,[role="navigation"],[role="complementary"],[role="dialog"],form,#content1,[data-course-flow-ui],[class*="comment" i],[id*="comment" i],[class*="discuss" i],[id*="discuss" i]';
  function lessonScope() {
    return document.querySelector('#pageDiv') || document.querySelector('main,article,[role="main"]') || document.body;
  }
  function lessonNodes(selector) {
    const scope = lessonScope();
    return scope ? [...(scope.matches(selector) && visible(scope) ? [scope] : []), ...query(selector, scope)].filter(n => !n.closest(outsideLesson)) : [];
  }
  function emptyContent() {
    return lessonNodes('p,span,div,section').some(n => n.children.length < 4 && !n.querySelector(outsideLesson) && /^暂无内容[。.!！]?$/.test(C.tidy(n.textContent)));
  }
  function hasMedia() {
    return lessonNodes('video,audio,object,embed,.video-js,[data-player],iframe[src*="video" i],iframe[src*="audio" i]').length > 0;
  }
  function loading() {
    return document.readyState !== 'complete' || lessonNodes('[aria-busy="true"],[role="progressbar"],.loading,.loader,.el-loading-mask,.ant-spin-spinning').length > 0;
  }
  function snapshot() {
    const page = C.pageKey(location.href);
    if (page !== lastPage) { videoProgress = { node: null, time: -1, at: Date.now() }; lastPage = page; }
    const video = videoNode();
    let stalled = '';
    if (video && !video.ended && !video.paused && Number.isFinite(video.duration)) {
      if (video !== videoProgress.node || video.currentTime !== videoProgress.time) {
        videoProgress = { node: video, time: video.currentTime, at: Date.now() };
      } else if (enabled && Date.now() - videoProgress.at > 120000) {
        stalled = '视频超过两分钟没有进展，已停止，请检查播放器';
      }
    }
    return {
      url: location.href, page, picking: Boolean(picking),
      heading: C.tidy(document.querySelector('h1,main h2,article h2')?.textContent).slice(0, 120),
      done: doneIndicator(), quiz: questionPresent(), blocked: blocker() || stalled,
      canNext: Boolean(nextButton()), canPlay: Boolean(playButton()),
      canSkipQuiz: Boolean(marked('skip')),
      canConfirmNext: Boolean(incompleteNavigationButton()),
      emptyContent: emptyContent(), hasMedia: hasMedia(), loading: loading(),
      lessonFrameUrls: topFrame ? lessonNodes('iframe[src]').map(n => { try { return C.pageKey(n.src); } catch { return ''; } }).filter(Boolean) : [],
      videoCount: marked('video') ? 1 : query('video').length,
      video: video ? { time: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : null, source: video.currentSrc || video.src, paused: video.paused, ended: video.ended, error: Boolean(video.error) } : null
    };
  }
  async function act(message) {
    if (!enabled || picking) return { ok: false, reason: '当前已停止或正在标记' };
    if (C.pageKey(location.href) !== message.page) return { ok: false, reason: '页面已变化，请重新开始' };
    const blocked = blocker();
    if (blocked) return { ok: false, reason: blocked };
    if (message.action === 'next' && message.emptyLesson && (hasMedia() || loading() || videoNode() || playButton() || questionPresent() || message.emptyInThisFrame && !emptyContent())) {
      return { ok: false, retry: true, reason: '章节内容已变化，重新检查页面' };
    }
    if (message.action === 'play') {
      const video = videoNode();
      if (video && !video.ended) {
        if (message.muted) video.muted = true;
        try { await video.play(); return { ok: true }; }
        catch { return { ok: false, reason: '浏览器阻止自动播放，请先手动点一次播放，再点击开始' }; }
      }
      const button = playButton();
      if (!button || !usable(button) || !C.safeNavigationText(text(button))) return { ok: false, reason: '没有可用的播放按钮，请重新标记' };
      button.click(); return { ok: true };
    }
    const node = message.action === 'confirmNext' && message.allowConfirmNext ? incompleteNavigationButton()
      : message.action === 'next' ? nextButton()
      : message.action === 'dismiss' && message.hasQuiz ? marked('skip') : null;
    if (!node || !usable(node) || !C.safeNavigationText(text(node))) return { ok: false, reason: '下一节或跳过按钮无效；不会点击提交答案' };
    node.scrollIntoView({ block: 'center', behavior: 'instant' });
    node.click(); return { ok: true };
  }
  function locator(node, role) {
    const esc = CSS.escape;
    let selector = '';
    if (node.id && !/ext-gen|\d{5,}|^vjs_/i.test(node.id)) selector = `#${esc(node.id)}`;
    if (!selector) {
      const parts = [];
      for (let n = node; n && n !== document.documentElement; n = n.parentElement) {
        let part = n.localName;
        const siblings = n.parentElement ? [...n.parentElement.children].filter(s => s.localName === n.localName) : [];
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(n) + 1})`;
        parts.unshift(part);
        if (document.querySelectorAll(parts.join(' > ')).length === 1) break;
      }
      selector = parts.join(' > ');
    }
    const label = text(node).slice(0, 100);
    const mark = { selector, text: ['next', 'play', 'skip', 'quiz'].includes(role) && label.length < 80 ? label : '' };
    if (role === 'done') {
      mark.expected = /任务点/.test(label) ? '任务点已完成' : /未完成|待完成/.test(label) ? '已完成' : label.slice(0, 100);
      if (!mark.expected) throw new Error('完成提示需要包含文字，请标记“任务点已完成”等提示文字');
    }
    return mark;
  }
  function cancelPicker() {
    picking = '';
    if (hovered) { hovered.style.outline = hovered.__cfOldOutline || ''; delete hovered.__cfOldOutline; hovered = null; }
    document.removeEventListener('pointerover', hover, true);
    document.removeEventListener('click', choose, true);
    document.removeEventListener('keydown', cancelKey, true);
  }
  function hover(event) {
    if (owned(event.target)) return;
    if (hovered) hovered.style.outline = hovered.__cfOldOutline || '';
    hovered = event.target;
    hovered.__cfOldOutline = hovered.style.outline;
    hovered.style.outline = '3px solid #12b8a6';
  }
  async function choose(event) {
    if (!picking || owned(event.target) || !event.isTrusted) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const role = picking;
    try {
      let target = event.target;
      if (target === document.body || target === document.documentElement) throw new Error('请标记具体控件或提示文字，不要选择整个页面');
      if (['play', 'next', 'skip'].includes(role)) target = target.closest('button,a,[role="button"]') || target;
      if (role === 'video') target = target.closest('video') || target.closest('.video-js, [data-player]') || target;
      if (['next', 'skip'].includes(role) && !C.safeNavigationText(text(target))) throw new Error('请标记下一节或跳过按钮，不能标记提交／交卷按钮');
      if (['next', 'skip', 'play'].includes(role) && !usable(target)) throw new Error('该控件不可用，或属于提交表单按钮，请选择其他控件');
      profile[role] = locator(target, role);
      await chrome.storage.local.set({ [profileKey]: profile });
      cancelPicker(); await send({ cmd: 'picked', label: labels[role] });
    } catch (error) { if (topFrame && statusText) statusText.textContent = error.message; }
  }
  function cancelKey(event) {
    if (event.key === 'Escape') { cancelPicker(); send({ cmd: 'picked', cancelled: true }).catch(() => {}); }
  }
  function startPicker(role) {
    cancelPicker();
    if (!labels[role]) return;
    picking = role;
    document.addEventListener('pointerover', hover, true);
    document.addEventListener('click', choose, true);
    document.addEventListener('keydown', cancelKey, true);
  }
  function createPanel() {
    if (!topFrame) return;
    const host = document.createElement('div');
    host.dataset.courseFlowUi = 'true';
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      :host{all:initial;font:13px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#eaf4f3}
      section{width:272px;background:#102d31;border:1px solid #2c555a;border-radius:15px;box-shadow:0 12px 40px #0003;padding:15px}
      header{display:flex;align-items:center;justify-content:space-between;font-weight:700;letter-spacing:1px}
      p{margin:9px 0 12px;color:#c0dbd9;min-height:38px;overflow-wrap:anywhere}
      button{border:0;border-radius:8px;padding:8px 12px;font:inherit;cursor:pointer;background:#65dec9;color:#092e30;font-weight:700}
      .small{background:transparent;color:#bdd7d5;padding:2px 6px} .foot{font-size:11px;color:#9fbfbd;margin-top:8px}
      [hidden]{display:none!important}
    </style><section><header><span>课序助手</span><button class="small" id="collapse" title="收起／展开">−</button></header>
      <div id="body"><p id="status">已停止 · 点击扩展图标可标记控件</p><button id="toggle">开始当前课程</button>
      <div class="foot">正常速度播放 · 测验跳过后仍为未完成</div></div></section>`;
    statusText = root.querySelector('#status'); toggleButton = root.querySelector('#toggle');
    toggleButton.addEventListener('click', () => send({ cmd: enabled ? 'panelStop' : 'panelRun' }).catch(showError));
    root.querySelector('#collapse').addEventListener('click', event => {
      const body = root.querySelector('#body'); body.hidden = !body.hidden; event.target.textContent = body.hidden ? '+' : '−';
    });
    document.documentElement.append(host); panel = host;
  }
  function showError(error) { if (statusText) statusText.textContent = error.message || '扩展已更新，请刷新课程页'; }
  function showStatus(state) {
    enabled = Boolean(state.running);
    if (statusText) statusText.textContent = `${state.status} · 本次切换 ${state.switches} 节，跳过 ${state.skipped} 个测验章节`;
    if (toggleButton) toggleButton.textContent = enabled ? '停止' : '开始当前课程';
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (!message?.cf || sender.id !== chrome.runtime.id) return;
    if (message.cmd === 'snapshot') { reply(snapshot()); return; }
    if (message.cmd === 'status') { if (topFrame) showStatus(message.state); return; }
    if (message.cmd === 'enabled') { enabled = message.enabled; videoProgress.at = Date.now(); if (enabled) setTimeout(tick, 50); return; }
    if (message.cmd === 'act') { act(message).then(reply).catch(error => reply({ ok: false, reason: error.message })); return true; }
    if (message.cmd === 'pick') { startPicker(message.role); reply({ ok: true }); return; }
    if (message.cmd === 'cancelPick') { cancelPicker(); return; }
    if (message.cmd === 'clear') { profile = {}; chrome.storage.local.remove(profileKey); cancelPicker(); reply({ ok: true }); }
  });
  async function tick() {
    if (!topFrame || !enabled || sending) return;
    sending = true;
    try {
      const response = await send({ cmd: 'report', snapshot: snapshot() });
      if (response?.result) enabled = response.result.enabled;
    } catch (error) { enabled = false; showError(error); }
    finally { sending = false; }
  }
  globalThis.__courseFlowAPI = { snapshot };
  (async () => {
    profile = (await chrome.storage.local.get(profileKey))[profileKey] || {};
    createPanel();
    const response = await send({ cmd: 'hello' });
    enabled = Boolean(response?.result?.enabled);
    if (topFrame && response?.result?.state) showStatus(response.result.state);
    setInterval(tick, 2200);
    tick();
  })().catch(showError);
})();
