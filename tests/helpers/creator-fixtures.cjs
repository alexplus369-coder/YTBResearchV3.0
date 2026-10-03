const core = require('../../creator-core.js');
const variants = ['Tu primer resultado con software', 'El error que frena tu productividad', 'Un método más claro para empezar'].map(title => ({ title,
    promise: 'Resolver una tarea verificable con una demostración propia.', hypothesis: 'Un problema concreto para principiantes.',
    thumbnail: { concept: 'Antes y después de una tarea', text: 'MENOS PASOS', elements: ['Resultado', 'Problema', 'Flecha'], prompt: '16:9 high contrast editorial thumbnail, two original workspaces and one arrow, leave room for text.' } }));
function block(slot) {
    const hook = 'Este paso cambia cómo organizas tu siguiente proyecto.';
    const rehook = 'Vamos a comparar dos formas de hacerlo y comprobar cuál reduce las tareas repetidas.';
    const prefix = slot.index === 0 ? hook + ' ' + rehook + ' ' : '';
    const narration = prefix + Array.from({ length: Math.max(1, slot.targetWords - core.words(prefix)) }, () => 'ejemplo').join(' ');
    return { index: slot.index, narration, hook: slot.index === 0 ? hook : '', rehook: slot.index === 0 ? rehook : '',
        openLoop: slot.index < 3 ? 'Después comprobaremos el punto clave con otra prueba.' : '', editing: 'B-roll y gráfico legible cada 5 s. SFX sutil y música moderada.',
        sourceIds: ['video000000', 'invented-id'], scenes: [{ visual: 'Demostración original en pantalla', imagePrompt: '16:9 original workspace, soft daylight, consistent blue palette.', videoPrompt: '5 second shot, gentle camera push into the same workspace, show one action.', negativePrompt: 'No logos, no invented charts.' }] };
}
function completeProject() {
    const p = core.profile({ niche: 'Software de productividad', audience: 'Arquitectos principiantes en México', duration: 9, ownFacts: 'Ejemplo propio por verificar.' });
    return { format: 'yt-creator-production', version: 1, profile: p, topic: 'Organización de proyectos', angle: 'Comparativa propia', createdAt: '2026-10-03T12:00:00.000Z',
        variants, selected: 1, blocks: core.timeline(9).map(block),
        sources: [{ id: 'video000000', title: 'Referencia', channel: 'Canal', capturedAt: '2026-10-03T11:00:00.000Z', views: 1000, viewsPerDay: 100, transcript: false }],
        monetization: ['Escenario manual de publicidad', 'Oferta por validar'], checks: ['Verificar demostración y cifras'], description: 'Demostración original.', pinnedComment: '¿Qué parte te resulta más difícil?' };
}
function publishing() { return { description: 'Aprende un método práctico con una demostración original.', pinnedComment: 'Comparte el problema que quieres resolver.', checks: ['Comprobar cada cifra', 'Grabar el ejemplo propio', 'Revisar derechos de recursos', 'Revisar la oferta', 'Verificar la promesa'] }; }
module.exports = { variants, block, completeProject, publishing };
