(() => {
  const calendar = document.getElementById('calendar-workspace');
  const settings = document.getElementById('settings-workspace');
  const calendarNav = document.getElementById('nav-calendar');
  const settingsNav = document.getElementById('nav-settings');
  let hasCalendars = null;
  let explicitPage = Boolean(location.hash);
  const pageFromHash = () => location.hash.includes('settings') || location.hash.startsWith('#step-') ? 'settings' : 'calendar';
  function navigate(page, focus = false) {
    const setup = page === 'settings';
    calendar.hidden = setup;
    settings.hidden = !setup;
    calendarNav.toggleAttribute('aria-current', !setup);
    settingsNav.toggleAttribute('aria-current', setup);
    (!setup ? calendarNav : settingsNav).setAttribute('aria-current', 'page');
    if (focus) (setup ? settings : calendar).focus({ preventScroll: true });
    window.dispatchEvent(new CustomEvent('famalio-view', { detail: setup ? 'settings' : 'calendar' }));
  }
  calendarNav.addEventListener('click', () => { explicitPage = true; location.hash = 'calendar'; });
  settingsNav.addEventListener('click', () => { explicitPage = true; location.hash = 'settings'; });
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-open-settings]')) { explicitPage = true; location.hash = 'settings'; }
  });
  window.addEventListener('hashchange', () => { explicitPage = true; navigate(pageFromHash(), true); });
  window.addEventListener('famalio-calendar-state', (event) => {
    // Supervisor discovery alone does not prove that HA accepted the integration.
    if (event.detail !== 'ready' && event.detail !== 'setup') return;
    const wasMissing = hasCalendars === false;
    hasCalendars = event.detail === 'ready';
    if (hasCalendars && (wasMissing || !explicitPage)) {
      history.replaceState(null, '', '#calendar');
      navigate('calendar', wasMissing);
    } else if (!hasCalendars && !explicitPage) navigate('settings');
  });
  navigate(explicitPage ? pageFromHash() : 'settings');
})();
