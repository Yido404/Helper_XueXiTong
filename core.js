(function (root) {
  'use strict';
  const tidy = value => String(value || '').replace(/\s+/g, ' ').trim();
  function pageKey(href) {
    const url = new URL(href);
    return url.origin + url.pathname + url.search + url.hash;
  }
  function scopeKey(href) {
    const url = new URL(href);
    const course = url.searchParams.get('courseId') || url.searchParams.get('courseid');
    const clazz = url.searchParams.get('clazzid') || url.searchParams.get('classId') || '';
    return course ? `${url.hostname}:${course}:${clazz}` : url.origin;
  }
  function completeText(value, custom = '') {
    const text = tidy(value);
    if (/未完成|待完成|尚未|未通过|not completed|incomplete/i.test(text)) return false;
    return custom ? text.includes(custom) : /任务点已完成|已完成任务点|任务已完成|学习完成|completed/i.test(text);
  }
  function safeNavigationText(value) {
    return !/提交|交卷|答案|支付|购买|删除|确认|submit|purchase|delete/i.test(tidy(value));
  }
  function decide(state, frames, now = Date.now()) {
    if (!state.running) return { type: 'idle', reason: state.status || '已停止' };
    const fresh = frames.filter(f => now - f.seenAt < 7500);
    const top = fresh.find(f => f.frameId === 0);
    if (!top) return { type: 'wait', reason: '等待课程页面响应' };
    if (scopeKey(top.url) !== state.scope) return { type: 'stop', reason: '已离开当前课程，自动停止' };
    if (fresh.some(f => f.picking)) return { type: 'wait', reason: '正在标记，请点击目标控件' };
    const blocker = fresh.find(f => f.blocked);
    if (blocker) return { type: 'stop', reason: blocker.blocked };
    const confirmation = fresh.find(f => f.canConfirmNext);
    // A second navigation click is allowed only after our own next action or on a quiz.
    // This also recovers a quiz prompt that was already open when the user restarted.
    if (confirmation && (state.pendingNavigation || fresh.some(f => f.quiz))) {
      return state.pendingNavigation?.confirmedAt
        ? { type: 'wait', reason: '已点击弹窗下一节，等待章节切换' }
        : { type: 'confirmNext', frameId: confirmation.frameId, reason: '未完成任务提示：点击弹窗下一节' };
    }
    if (now < state.settleUntil) return { type: 'wait', reason: '等待下一节加载' };
    const videos = fresh.filter(f => f.video);
    const quiz = fresh.find(f => f.quiz);
    if (quiz) {
      const dismiss = fresh.find(f => f.canSkipQuiz);
      if (dismiss) return { type: 'dismiss', frameId: dismiss.frameId, reason: '点击已标记的跳过／关闭按钮' };
      const next = fresh.find(f => f.canNext);
      return next ? { type: 'next', frameId: next.frameId, reason: '跳过题目所在章节' }
        : { type: 'stop', reason: '遇到题目，未找到下一节；请标记下一节或跳过按钮' };
    }
    // A task indicator is the platform's completion signal. Without it, wait for video ended.
    const videoCount = videos.reduce((sum, frame) => sum + (frame.videoCount || 1), 0);
    const done = (videoCount <= 1 && fresh.some(f => f.done)) || (videos.length > 0 && videos.every(f => f.video.ended));
    if (done) {
      const next = fresh.find(f => f.canNext);
      return next ? { type: 'next', frameId: next.frameId, reason: '任务完成，进入下一节' }
        : { type: 'stop', reason: '当前任务已完成，未找到下一节（可能已到课程末尾）' };
    }
    const paused = videos.find(f => f.video.paused && !f.video.ended && !f.video.error);
    if (paused) return { type: 'play', frameId: paused.frameId, reason: '继续播放视频' };
    if (videos.some(f => f.video.error)) return { type: 'wait', reason: '视频加载失败，请检查页面或网络' };
    if (videos.length) {
      const v = videos[0].video;
      return { type: 'wait', reason: `正常播放 ${formatTime(v.time)} / ${formatTime(v.duration)}` };
    }
    const starter = fresh.find(f => f.canPlay);
    if (starter) return { type: 'play', frameId: starter.frameId, reason: '点击播放按钮' };
    return { type: 'wait', reason: '未识别到视频；可手动标记播放器或播放按钮' };
  }
  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '--:--';
    const n = Math.max(0, Math.floor(seconds));
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  }
  const api = { tidy, pageKey, scopeKey, completeText, safeNavigationText, decide, formatTime };
  root.CourseFlowCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
