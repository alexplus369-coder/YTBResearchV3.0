/* Replicate selectors and schema-driven controls. No tokens or input values are persisted. */
(function () {
    'use strict';
    const $ = id => document.getElementById(id), h = value => escHtml(String(value ?? ''));
    const labels = { image: 'Imagen', video: 'Video', music: 'Música', voice: 'Voz / narración' };
    window.ReplicateStudio = {
        create(api) {
            let catalog = [], caps = {}, epoch = 0, current = 'image', connected = false, busy = false;
            const states = {}, configured = { visual: null, music: false, voice: false };
            const comparison = window.ReplicateValue?.mount(window.ReplicateCatalog, chooseModel);
            const state = () => states[current] || (states[current] = { model: '', meta: null, inputs: {}, file_inputs: {} });
            const properties = () => state().meta?.input_schema?.properties || {};
            const textField = (kind, fields) => (kind === 'voice' ? ['text', 'prompt', 'transcript'] : ['prompt']).find(k => fields[k]);
            function fieldShape(value) {
                const shape = Object.assign({}, ...(value.allOf || []).map(fieldShape), value);
                if (Array.isArray(shape.type)) shape.type = shape.type.find(t => t !== 'null');
                return shape;
            }
            function fileField(value) {
                const s = fieldShape(value);
                return ['uri', 'url'].includes(s.format) || s['x-cog-file'] || (s.type === 'array' && fileField(s.items || {}));
            }
            function lock() {
                const ready = connected && !busy && !!state().meta;
                $('replicate-generate').disabled = !ready || !$('replicate-paid').checked;
                $('replicate-apply').disabled = !ready;
                $('replicate-model').disabled = busy || !connected;
                $('replicate-kind').disabled = busy;
                $('replicate-load').disabled = busy || !connected;
                $('replicate-prompt').disabled = !ready || !textField(current, properties());
            }
            function destinations() {
                const old = $('replicate-destination').value;
                const p = api.project();
                let html = '<option value="library">Guardar en mis recursos</option>';
                if (current === 'image' || current === 'video') {
                    let index = 0;
                    html += (p?.blocks || []).map(b => b.scenes.map(s => '<option value="scene:' + index++ + '">Bloque ' + (b.index + 1) + ' · ' + h(s.visual.slice(0, 70)) + '</option>').join('')).join('');
                    if (current === 'image') html += '<option value="thumbnail">Miniatura (descargar y revisar)</option>';
                } else html += '<option value="' + current + '">' + (current === 'music' ? 'Música de fondo' : 'Narración propia') + '</option>';
                $('replicate-destination').innerHTML = html;
                $('replicate-destination').value = [...$('replicate-destination').options].some(o => o.value === old) ? old : current === 'music' || current === 'voice' ? current : 'library';
            }
            function fields() {
                const s = state(), props = properties(), required = new Set(s.meta?.input_schema?.required || []);
                const model = catalog.find(m => m.id === s.model);
                $('replicate-license-state').innerHTML = model ? h(model.license_warning || 'Revisa los precios y la licencia del modelo y de sus referencias antes de monetizar.') + ' <a class="underline" href="https://replicate.com/' + h(model.id) + '" target="_blank" rel="noopener noreferrer">Ver ficha del modelo</a>' : '';
                $('replicate-fields').innerHTML = Object.entries(props).sort((a, b) => (a[1]['x-order'] ?? 999) - (b[1]['x-order'] ?? 999)).map(([name, raw], i) => {
                    const f = fieldShape(raw), value = s.inputs[name], attr = ' data-replicate-field="' + h(name) + '" id="replicate-input-' + i + '" class="block w-full mt-1 p-2 border rounded-lg font-normal"';
                    const title = '<label for="replicate-input-' + i + '" class="text-xs font-bold">' + h(f.title || name) + (required.has(name) ? ' *' : '') + '</label><p class="text-[11px] text-slate-500 break-words">' + h(name) + ' · ' + h((f.description || '').slice(0, 350)) + '</p>';
                    if (f['x-cog-secret']) return '<div>' + title + '<p class="text-xs text-amber-700">Campo secreto no admitido. No pegues claves aquí.</p></div>';
                    let control;
                    if (fileField(f)) {
                        const array = f.type === 'array', selected = s.file_inputs[name] || [];
                        control = '<select data-replicate-file="' + h(name) + '" id="replicate-input-' + i + '"' + (array ? ' multiple' : '') + ' class="block w-full mt-1 p-2 border rounded-lg font-normal"><option value="">Sin referencia local</option>' + api.assets().map(a => '<option value="' + h(a.id) + '"' + (selected.includes(a.id) ? ' selected' : '') + '>' + h(a.name) + ' · ' + h(a.kind) + '</option>').join('') + '</select><' + (array ? 'textarea' : 'input type="url"') + attr + ' placeholder="' + (array ? 'URLs HTTPS, una por línea' : 'https://… (opcional si seleccionas un recurso local)') + '"' + (array ? '>' + h(Array.isArray(value) ? value.join('\n') : '') + '</textarea>' : ' value="' + h(value || '') + '">');
                    } else if (f.enum) {
                        control = '<select' + attr + '><option value="">Usar valor predeterminado</option>' + f.enum.map(v => '<option value="' + h(JSON.stringify(v)) + '"' + (JSON.stringify(value) === JSON.stringify(v) ? ' selected' : '') + '>' + h(v) + '</option>').join('') + '</select>';
                    } else if (f.type === 'boolean') {
                        control = '<select' + attr + '><option value="">Usar valor predeterminado</option><option value="true"' + (value === true ? ' selected' : '') + '>Sí</option><option value="false"' + (value === false ? ' selected' : '') + '>No</option></select>';
                    } else if (f.type === 'number' || f.type === 'integer') {
                        control = '<input type="number"' + attr + ' step="' + (f.type === 'integer' ? '1' : f.multipleOf || 'any') + '"' + (f.minimum !== undefined ? ' min="' + h(f.minimum) + '"' : '') + (f.maximum !== undefined ? ' max="' + h(f.maximum) + '"' : '') + ' value="' + h(value ?? '') + '">';
                    } else {
                        const json = f.type === 'array' || f.type === 'object' || (!f.type && (f.anyOf || f.oneOf));
                        control = '<textarea' + attr + ' rows="3" placeholder="' + (json ? 'JSON válido' : 'Texto') + '">' + h(value == null ? '' : json ? JSON.stringify(value, null, 2) : value) + '</textarea>';
                    }
                    return '<div>' + title + control + '</div>';
                }).join('');
                const f = textField(current, props);
                $('replicate-schema-state').textContent = s.meta ? Object.keys(props).length + ' parámetros · ' + (s.meta.api_mode === 'official' ? 'esquema ' : 'versión ') + s.meta.version.slice(0, 12) + (s.meta.api_mode === 'official' ? ' · versión gestionada por Replicate' : '') + (f ? ' · El modo automático reemplaza ' + f + ' con el guion/prompt de cada escena.' : ' · Este modelo requiere generación individual.') : 'Selecciona un modelo y carga sus parámetros.';
                lock();
            }
            function models() {
                const s = state(), available = window.ReplicateValue ? window.ReplicateValue.rank(catalog, current) : catalog.filter(m => m.kind === current);
                $('replicate-model').innerHTML = '<option value="">Seleccionar modelo</option>' + available.map(m => '<option value="' + h(m.id) + '">' + h(m.label + ' · ' + m.id + (m.operation === 'transform' ? ' · requiere referencias' : '')) + '</option>').join('');
                $('replicate-model').value = s.model;
                $('replicate-catalog-state').textContent = available.length + ' modelos de ' + labels[current].toLowerCase() + '. La disponibilidad se consulta al cargar parámetros; revisa los permisos comerciales de cada modelo. Figurar aquí no garantiza su funcionamiento.';
                destinations(); fields();
            }
            async function loadSchema(refresh = false) {
                const s = state(), token = ++epoch, model = s.model;
                const previousText = refresh ? { ...s.inputs } : null;
                s.meta = null; s.inputs = {}; s.file_inputs = {}; fields();
                if (!model) return;
                const meta = await api.request('/replicate/models/' + model + '/schema' + (refresh ? '?refresh=true' : ''));
                if (token !== epoch || s !== state() || s.model !== model) return;
                s.meta = meta;
                for (const [name, raw] of Object.entries(meta.input_schema.properties || {})) {
                    const f = fieldShape(raw);
                    if (f.default !== undefined && f.default !== null && !f['x-cog-secret']) s.inputs[name] = f.default;
                }
                const name = textField(current, meta.input_schema.properties || {});
                if (name && typeof previousText?.[name] === 'string') s.inputs[name] = previousText[name];
                fields(); api.status(refresh ? 'Parámetros actualizados desde Replicate; prompt conservado. Revisa las demás opciones y referencias antes de generar.' : 'Parámetros cargados. Revisa opciones y permisos antes de generar.');
            }
            function selection(kind) {
                const s = states[kind];
                if (!s?.meta) throw new Error('Configura y carga un modelo de ' + labels[kind] + '.');
                return { model: s.model, kind, version: s.meta.version, inputs: s.inputs, file_inputs: s.file_inputs };
            }
            function open(kind = current) {
                if (!caps.replicateCatalog) return;
                current = kind; $('replicate-kind').value = kind; $('replicate-panel').classList.remove('hidden');
                api.work('Abriendo catálogo de Replicate…', async () => {
                    if (!caps.replicate) throw new Error('Configura REPLICATE_API_TOKEN y reinicia el servidor.');
                    if (!catalog.length) {
                        const token = epoch, result = await api.request('/replicate/models');
                        if (token !== epoch || !connected) return;
                        catalog = result.models;
                    }
                    models(); api.status('Catálogo disponible. Elige un modelo; no se ha iniciado ninguna generación.');
                });
            }
            async function chooseModel(id) {
                if (!connected || busy || !caps.replicateCatalog) return;
                const entry = window.ReplicateCatalog?.models.find(m => m.id === id);
                if (!entry || !['image', 'video'].includes(entry.kind)) return;
                $('creator-tab-studio')?.click();
                current = entry.kind; $('replicate-kind').value = current;
                $('replicate-panel').classList.remove('hidden');
                await api.work('Cargando modelo del comparador…', async () => {
                    if (!caps.replicate) throw new Error('Configura REPLICATE_API_TOKEN y reinicia el servidor.');
                    if (!catalog.length) catalog = (await api.request('/replicate/models')).models;
                    if (!connected) return;
                    state().model = id; models(); await loadSchema();
                });
                $('replicate-panel').scrollIntoView({ block: 'start', behavior: 'smooth' });
            }
            $('replicate-open').addEventListener('click', () => open());
            $('replicate-kind').addEventListener('change', () => { epoch++; current = $('replicate-kind').value; models(); });
            $('replicate-model').addEventListener('change', () => {
                state().model = $('replicate-model').value;
                api.work('Cargando parámetros de Replicate…', loadSchema);
            });
            $('replicate-load').addEventListener('click', () => api.work('Actualizando parámetros desde Replicate…', () => loadSchema(true)));
            $('replicate-fields').addEventListener('input', event => {
                const name = event.target.dataset.replicateField;
                if (!name) return;
                const f = fieldShape(properties()[name]), value = event.target.value;
                if (value === '') delete state().inputs[name];
                else if (event.target.tagName === 'SELECT' || ['array', 'object', 'boolean', 'number', 'integer'].includes(f.type) || (!f.type && (f.anyOf || f.oneOf))) {
                    if (fileField(f) && f.type === 'array') state().inputs[name] = value.split('\n').map(v => v.trim()).filter(Boolean);
                    else { try { state().inputs[name] = JSON.parse(value); } catch { state().inputs[name] = value; } }
                } else state().inputs[name] = value;
            });
            $('replicate-fields').addEventListener('change', event => {
                const name = event.target.dataset.replicateFile;
                if (name) {
                    const ids = [...event.target.selectedOptions].map(o => o.value).filter(Boolean);
                    if (ids.length) state().file_inputs[name] = ids; else delete state().file_inputs[name];
                }
            });
            $('replicate-paid').addEventListener('change', lock);
            $('replicate-prompt').addEventListener('click', () => {
                const p = api.project(), name = textField(current, properties()); if (!p || !name) return;
                const dest = $('replicate-destination').value;
                const scene = p.blocks.flatMap(b => b.scenes)[Number(dest.split(':')[1] || 0)];
                state().inputs[name] = current === 'voice' ? p.blocks.map(b => b.narration).join('\n\n') : current === 'music' ? 'Música instrumental discreta, sin voz, para un video sobre ' + p.topic : dest === 'thumbnail' ? p.packaging.thumbnail?.prompt || p.topic : (current === 'video' ? scene?.videoPrompt : scene?.imagePrompt) || scene?.visual || p.topic;
                fields();
            });
            $('replicate-apply').addEventListener('click', () => {
                try {
                    selection(current);
                    if (current === 'image' || current === 'video') {
                        if (!textField(current, properties())) throw new Error('Este modelo no admite prompts automáticos. Genera un recurso individual y asígnalo a una escena.');
                        configured.visual = current;
                    } else configured[current] = true;
                    api.apply(current); api.status(labels[current] + ' configurado para el MP4. Se generará únicamente al enviar el trabajo y confirmar el pago.');
                } catch (e) { api.error(e); }
            });
            $('replicate-generate').addEventListener('click', () => api.work('Enviando recurso a Replicate…', async () => {
                if (!$('replicate-paid').checked) throw new Error('Confirma el pago para generar el recurso individual.');
                const destination = $('replicate-destination').value, kind = current, signature = api.signature();
                const job = await api.post('/replicate/resources', { selection: selection(kind), paid_generation_confirmed: true });
                await api.queued(job, { destination, kind, signature });
                $('replicate-paid').checked = false; lock(); api.status('Recurso ' + job.id.slice(0, 8) + ' en cola. No vuelvas a generar si solo necesitas reintentar.');
            }));
            return {
                open,
                lock(isConnected, isBusy) { connected = isConnected; busy = isBusy; lock(); $('replicate-open').disabled = !connected || busy; comparison?.lock(connected && !!caps.replicateCatalog && !!caps.replicate, busy); },
                connect(capabilities) { caps = capabilities; },
                reset() { epoch++; catalog = []; for (const k of Object.keys(states)) delete states[k]; configured.visual = null; configured.music = configured.voice = false; caps = {}; $('replicate-paid').checked = false; fields(); },
                assetsChanged() { if (state().meta) fields(); destinations(); },
                options(materials, tts, music) {
                    if (!caps.replicateCatalog) return {};
                    const options = { music_source: music };
                    if (materials === 'replicate') {
                        if (configured.visual) options.replicate_visual = selection(configured.visual);
                        else if (!caps.replicateLegacy) throw new Error('Elige un modelo de imagen/video y pulsa Usar modelo en MP4.');
                    }
                    if (tts === 'replicate') { if (!configured.voice) throw new Error('Configura un modelo de voz y pulsa Usar modelo en MP4.'); options.replicate_voice = selection('voice'); }
                    if (music === 'replicate') { if (!configured.music) throw new Error('Configura un modelo de música y pulsa Usar modelo en MP4.'); options.replicate_music = selection('music'); }
                    return options;
                }
            };
        }
    };
})();
