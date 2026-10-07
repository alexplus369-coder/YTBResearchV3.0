(function () {
    'use strict';
    const control = document.getElementById('studio-theme'), themes = ['graphite', 'midnight', 'warm'];
    control.value = themes.includes(document.documentElement.dataset.theme) ? document.documentElement.dataset.theme : 'graphite';
    control.addEventListener('change', () => {
        const theme = themes.includes(control.value) ? control.value : 'graphite';
        document.documentElement.dataset.theme = theme;
        try { localStorage.setItem('ytStudioThemeV1', theme); } catch {}
    });
})();
