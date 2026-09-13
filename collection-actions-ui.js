(function () {
  let busy = false;

  function enabled() {
    const status = window.answerTravelApiClient?.status?.();
    return Boolean(status?.enabled && status?.ready);
  }

  async function run(action, resourceId) {
    if (busy) return;
    busy = true;
    try {
      const client = window.answerTravelApiClient;
      if (action === 'rerun-record') await client.rerunRecord(resourceId);
      if (action === 'retry-task') await client.retryTask(resourceId);
      if (action === 'cancel-task') await client.cancelTask(resourceId);
      await client.refreshFromServer({ silent: true });
      document.querySelector('.modal-backdrop.open [data-action="close-modal"]')?.click();
      window.note?.(action === 'cancel-task' ? '任务已取消。' : action === 'retry-task' ? '任务已重新排队。' : '已创建新的采集批次，原回答已保留。');
    } catch (error) {
      window.note?.(`操作失败：${error.message}`);
    } finally {
      busy = false;
    }
  }

  window.addEventListener('click', (event) => {
    if (!enabled()) return;
    const button = event.target.closest('[data-action]');
    const action = button?.dataset.action;
    if (!['rerun-record', 'retry-task', 'cancel-task'].includes(action)) return;
    const resourceId = action === 'rerun-record' ? button.dataset.recordId : button.dataset.taskId;
    if (!resourceId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    run(action, resourceId);
  }, true);
})();
