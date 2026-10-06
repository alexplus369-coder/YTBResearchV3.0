/* Public, offline catalogue comparison. Selecting a model never starts a prediction. */
(function (root) {
    'use strict';
    const visual = model => ['image', 'video'].includes(model.kind);
    const number = value => Number.isFinite(value) && value > 0;
    function cheapest(model) {
        const p = model.pricing;
        if (!visual(model) || p?.status !== 'verified' || p.unit !== (model.kind === 'image' ? 'image' : 'second')) return null;
        return (p.variants || []).filter(v => number(v.usd)).reduce((best, v) => !best || v.usd < best.usd ? v : best, null);
    }
    function rank(models, kind, query = '', operation = '') {
        const term = query.trim().toLocaleLowerCase('es');
        return models.filter(m => m.kind === kind && (!operation || m.operation === operation) &&
            (m.label + ' ' + m.id).toLocaleLowerCase('es').includes(term)).slice().sort((a, b) =>
            (cheapest(a)?.usd ?? Infinity) - (cheapest(b)?.usd ?? Infinity) || a.label.localeCompare(b.label, 'es'));
    }
    function yieldFor(model, budget = 1) {
        const price = cheapest(model);
        if (!price || !number(budget)) return null;
        return model.kind === 'image' ? Math.floor(budget / price.usd + 1e-9) : budget / price.usd;
    }
    function mount(catalog, choose) {
        const $ = id => document.getElementById(id), panel = $('replicate-value-panel');
        if (!panel || !catalog?.models) return;
        const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
        const fmt = value => value.toLocaleString('es-MX', { maximumFractionDigits: 2 });
        let connected = false, busy = false;
        function render() {
            const budget = Number($('replicate-value-budget').value), valid = number(budget) && budget <= 100000;
            const query = $('replicate-value-search').value, operation = $('replicate-value-operation').value;
            $('replicate-value-status').textContent = 'Precios consultados: ' + catalog.pricing_checked_at + '. ' +
                (valid ? 'Simulación; no limita gastos. Mayor rendimiento arriba; imágenes enteras y segundos teóricos. ' : 'Introduce un presupuesto mayor que cero. ') +
                'La configuración indicada puede diferir de la predeterminada. Tarifas sin verificar al final.';
            for (const kind of ['image', 'video']) {
                const models = rank(catalog.models, kind, query, operation);
                $('replicate-value-count-' + kind).textContent = String(models.length);
                $('replicate-value-rows-' + kind).innerHTML = models.map(m => {
                    const price = cheapest(m), count = valid ? yieldFor(m, budget) : null;
                    const unit = kind === 'image' ? 'imagen' : 's';
                    return '<tr data-value-model="' + h(m.id) + '"><td><button type="button" data-value-select="' + h(m.id) + '"' +
                        (!connected || busy ? ' disabled' : '') + ' title="Cargar parámetros; no genera ni cobra">' + h(m.label) + '</button>' +
                        '<span class="value-operation">' + (m.operation === 'transform' ? 'Edición · requiere recurso' : 'Generación') + (m.output_format === 'svg' ? ' · SVG' : '') + '</span>' +
                        '<a href="' + h(m.url) + '" target="_blank" rel="noopener noreferrer">Ficha y precio ↗</a></td>' +
                        '<td>' + (price ? 'US$' + h(price.usd) + '/' + unit : m.pricing?.status === 'runtime' ? 'GPU variable' : 'Por verificar') + '<span class="value-condition">' + h(price?.conditions || 'No comparable') + '</span>' +
                        (m.pricing?.notes ? '<details class="value-condition"><summary>Condiciones</summary>' + h(m.pricing.notes) + '</details>' : '') + '</td>' +
                        '<td class="value-yield">' + (count == null ? '—' : kind === 'image' ? '≈' + fmt(count) + ' imgs' : '≈' + fmt(count) + ' s') + '</td></tr>';
                }).join('') || '<tr><td colspan="3">No hay modelos con este filtro.</td></tr>';
                $('replicate-value-heading-' + kind).textContent = (kind === 'image' ? 'Imágenes' : 'Video') + ' por US$' + (valid ? fmt(budget) : '—');
            }
            $('replicate-value-connect').textContent = connected ? 'Pulsa un modelo para cargar sus parámetros; no inicia una generación.' : 'Conecta el motor en Estudio → Fábrica para elegir un modelo. Consultar esta lista no requiere clave.';
        }
        $('replicate-value-search').addEventListener('input', render);
        $('replicate-value-budget').addEventListener('input', render);
        $('replicate-value-operation').addEventListener('change', render);
        panel.addEventListener('click', event => {
            const button = event.target.closest('button[data-value-select]');
            if (button && connected && !busy) choose(button.dataset.valueSelect);
        });
        render();
        return { lock(isConnected, isBusy) { connected = isConnected; busy = isBusy; render(); } };
    }
    const api = { cheapest, rank, yieldFor, mount };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ReplicateValue = api;
})(typeof window !== 'undefined' ? window : globalThis);
