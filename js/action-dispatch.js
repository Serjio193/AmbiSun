function dispatchAmbiSunAction(el, direction) {
  const action = el && el.dataset ? el.dataset.action : null;
  if (!action) return;

  const handler = window.AmbiSunActions && window.AmbiSunActions[action];
  if (!handler) {
    window.showToast(`No handler: ${action}`);
    return;
  }

  try {
    const result = handler({el, direction});
    if (result && typeof result.catch === 'function') {
      result.catch(err => {
        console.error('AmbiSun action failed:', action, err);
        window.showToast(`Action failed: ${action}`, 2200);
      });
    }
  } catch (err) {
    console.error('AmbiSun action failed:', action, err);
    window.showToast(`Action failed: ${action}`, 2200);
  }
}

window.dispatchAmbiSunAction = dispatchAmbiSunAction;
