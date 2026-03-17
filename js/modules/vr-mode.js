import * as THREE from "three";
import { VRButton } from "VRButton";
import { DeviceOrientationControls } from "DeviceOrientationControls";

let vrControls = null;
let isActive = false;
let savedCameraState = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

// NEU: WebGL Visor für Cardboard-Filter (da CSS in WebXR ignoriert wird)
let vrFilterMesh = null;

function showVRLoader(show, text = 'Lade 3D-Assets...') {
    let loader = document.getElementById('vr-local-loader');
    if (show) {
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'vr-local-loader';
            loader.style.cssText = 'position:fixed; inset:0; background:rgba(17,24,39,0.95); z-index:99999; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white; font-family:"Inter", sans-serif; backdrop-filter:blur(10px);';
            
            const spinner = document.createElement('div');
            spinner.style.cssText = 'width:50px; height:50px; border:4px solid rgba(255,255,255,0.2); border-top-color:#3b82f6; border-radius:50%; animation:vr-spin 1s linear infinite; margin-bottom:20px;';
            
            const style = document.createElement('style');
            style.textContent = '@keyframes vr-spin { to { transform: rotate(360deg); } }';
            document.head.appendChild(style);
            
            const textEl = document.createElement('div');
            textEl.id = 'vr-loader-text';
            textEl.style.fontSize = '18px';
            textEl.style.fontWeight = 'bold';
            textEl.innerText = text;
            
            loader.appendChild(spinner);
            loader.appendChild(textEl);
            document.body.appendChild(loader);
        } else {
            document.getElementById('vr-loader-text').innerText = text;
            loader.style.display = 'flex';
        }
    } else {
        if (loader) loader.style.display = 'none';
    }
}

function toggleMainUI(show) {
    const uiLayer = document.getElementById('ui-layer');
    const homeScreen = document.getElementById('homescreen');
    const overlay = document.getElementById('modal-overlay');
    const oldLabMenu = document.querySelector('.vr-menu-container'); 
    
    if (show) {
        if(homeScreen) homeScreen.style.display = 'flex';
    } else {
        // ALLES verstecken außer unserem neuen VR Overlay!
        if(uiLayer) uiLayer.style.display = 'none';
        if(homeScreen) homeScreen.style.display = 'none';
        if(overlay) overlay.classList.remove('active');
        if(oldLabMenu) oldLabMenu.style.display = 'none'; 
    }
}

async function enterFullscreenAndLandscape() {
    const elem = document.documentElement;
    try {
        if (elem.requestFullscreen) await elem.requestFullscreen();
        else if (elem.webkitRequestFullscreen) await elem.webkitRequestFullscreen();
        if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(()=>{}); 
    } catch (err) { console.warn("Fullscreen/Orientation restricted.", err); }
}

// Exklusive Shader-Steuerung nur fuer VR
function applyVRShader(filterStr, severity) {
    if (!vrFilterMesh || !vrFilterMesh.material.uniforms || !window.app.mainScene) return;

    // Reset Filter
    vrFilterMesh.material.uniforms.opacity.value = 0.0;
    vrFilterMesh.material.uniforms.mode.value = 0; 
    vrFilterMesh.material.uniforms.severity.value = parseFloat(severity);
    if (window.app.mainScene.fog) window.app.mainScene.fog.density = 0;

    if (filterStr === 'none') return;

    // Simulationen mathematisch berechnen
    if (filterStr === 'sim-blur') window.app.mainScene.fog.density = 0.05 + (severity * 0.02);
    if (filterStr === 'sim-blind') {
        vrFilterMesh.material.uniforms.mode.value = 6;
        vrFilterMesh.material.uniforms.opacity.value = 0.98;
    }
    if (filterStr === 'tunnel') {
        vrFilterMesh.material.uniforms.mode.value = 1;
        vrFilterMesh.material.uniforms.opacity.value = 1.0;
    }
    if (filterStr === 'spot') {
        vrFilterMesh.material.uniforms.mode.value = 2;
        vrFilterMesh.material.uniforms.opacity.value = 1.0;
    }
    if (filterStr === 'sim-cataract') {
        vrFilterMesh.material.uniforms.mode.value = 3;
        vrFilterMesh.material.uniforms.opacity.value = 0.2 + (severity * 0.1);
        window.app.mainScene.fog.density = 0.05 + (severity * 0.02);
    }
    if (filterStr === 'sim-glaucoma') {
        vrFilterMesh.material.uniforms.mode.value = 4;
        vrFilterMesh.material.uniforms.opacity.value = 0.5 + (severity * 0.1);
    }
}

// Baut das neue, freistehende Menue am unteren Bildschirmrand
function buildVRMenu() {
    let container = document.getElementById('custom-vr-menu');
    
    // ZWINGEND: Das Hintergrund-Overlay darf Klicks nicht blockieren!
    const overlay = document.getElementById('vr-overlay');
    if (overlay) overlay.style.pointerEvents = 'none';

    if (!container) {
        container = document.createElement('div');
        container.id = 'custom-vr-menu';
        // ZWINGEND: Z-Index maximieren, pointer-events: auto fuer Klicks, touch-action gegen Webseiten-Zoom
        container.style.cssText = 'position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 15px; z-index: 2147483647; background: rgba(17, 24, 39, 0.85); padding: 20px; border-radius: 16px; backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.1); width: 90%; max-width: 600px; pointer-events: auto; touch-action: none;';

        // 1. Slider für Schweregrad
        const sliderRow = document.createElement('div');
        sliderRow.style.cssText = 'width: 100%; display: flex; flex-direction: column; gap: 8px; margin-bottom: 5px;';
        sliderRow.innerHTML = `
            <div style="display: flex; justify-content: space-between; color: white; font-family: 'Inter', sans-serif; font-size: 12px; font-weight: bold;">
                <span style="color: #9ca3af;">Schweregrad der Einschränkung</span>
                <span id="vr-severity-val" style="color: #3b82f6;">Mittel (2.0)</span>
            </div>
            <input type="range" id="vr-severity-slider" min="0.5" max="3.0" step="0.1" value="2.0" style="width: 100%; cursor: pointer;">
        `;
        container.appendChild(sliderRow);

        // 2. Buttons
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; flex-wrap: wrap; justify-content: center; gap: 8px;';
        
        const addBtn = (id, text) => {
            const b = document.createElement('button');
            b.className = 'custom-vr-filter-btn';
            b.dataset.filter = id;
            b.innerText = text;
            b.style.cssText = 'background: rgba(255,255,255,0.1); color: #d1d5db; border: 1px solid rgba(255,255,255,0.2); padding: 10px 16px; border-radius: 8px; cursor: pointer; font-family: "Inter", sans-serif; font-size: 13px; font-weight: 600; transition: all 0.2s;';
            btnRow.appendChild(b);
        };

        addBtn('none', 'Normal');
        addBtn('sim-blur', 'Unschärfe');
        addBtn('sim-cataract', 'Grauer Star');
        addBtn('sim-glaucoma', 'Grüner Star');
        addBtn('tunnel', 'Tunnelblick');
        addBtn('spot', 'Makula (Spot)');
        addBtn('sim-blind', 'Blindheit');

        container.appendChild(btnRow);
        document.getElementById('vr-overlay').appendChild(container);

        // State & Listeners
        let currentActiveFilter = 'none';
        const slider = document.getElementById('vr-severity-slider');
        const valLabel = document.getElementById('vr-severity-val');

        slider.addEventListener('input', (e) => {
            valLabel.innerText = 'Wert: ' + e.target.value;
            applyVRShader(currentActiveFilter, e.target.value);
        });

        const btns = container.querySelectorAll('.custom-vr-filter-btn');
        btns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                btns.forEach(b => { b.style.background = 'rgba(255,255,255,0.1)'; b.style.color = '#d1d5db'; });
                e.target.style.background = '#3b82f6';
                e.target.style.color = 'white';
                
                currentActiveFilter = e.target.dataset.filter;
                applyVRShader(currentActiveFilter, slider.value);
            });
        });
        
        // Initialsierung auf "Normal"
        btns[0].style.background = '#3b82f6';
        btns[0].style.color = 'white';
    }
    container.style.display = 'flex';
}

function initOverlayListeners() {
    const closeBtn = document.getElementById('vr-close-btn');
    if (closeBtn && !closeBtn.dataset.vrBound) {
        closeBtn.addEventListener('click', stopVRMode);
        closeBtn.dataset.vrBound = "true";
    }
}

// Styling Injection für den hässlichen ThreeJS Standard-Button
function injectVRButtonStyle() {
    if (document.getElementById('vr-btn-style')) return;
    const style = document.createElement('style');
    style.id = 'vr-btn-style';
    style.innerHTML = `
        #webxr-btn {
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%) !important;
            color: white !important;
            border: 2px solid rgba(255,255,255,0.3) !important;
            border-radius: 12px !important;
            padding: 16px 28px !important;
            font-family: 'Inter', sans-serif !important;
            font-weight: 800 !important;
            font-size: 16px !important;
            box-shadow: 0 10px 25px rgba(59,130,246,0.6) !important;
            text-transform: uppercase !important;
            letter-spacing: 2px !important;
            transition: transform 0.2s !important;
            top: 20px !important; 
            bottom: auto !important; 
        }
        #webxr-btn:hover { transform: translateX(-50%) scale(1.05) !important; }
    `;
    document.head.appendChild(style);
}

// NEU: Injiziert fehlende UI-Buttons in dein VR-Menü
function injectMissingFilterButtons() {
    const firstBtn = document.querySelector('.vr-filter-btn');
    if (!firstBtn) return;
    const container = firstBtn.parentElement;
    
    const existingFilters = Array.from(container.children).map(b => b.getAttribute('data-filter'));
    
    const addBtn = (filter, text) => {
        if (!existingFilters.includes(filter)) {
            const btn = document.createElement('button');
            btn.className = 'vr-filter-btn';
            btn.setAttribute('data-filter', filter);
            btn.innerText = text;
            btn.style.cssText = 'background: rgba(255,255,255,0.1); color: #d1d5db; border: 1px solid rgba(255,255,255,0.2); padding: 8px 16px; border-radius: 6px; cursor: pointer; margin: 4px; font-family: "Inter", sans-serif; transition: all 0.2s;';
            container.appendChild(btn);
        }
    };

    addBtn('sim-cataract', 'Grauer Star');
    addBtn('sim-glaucoma', 'Grüner Star');
    addBtn('sim-blind', 'Blindheit');
}

export async function startVRMode() {
    try {
        if (isActive) return;
        window.app.vrIsActive = true;
        
        // 1. Engine Start & Auto-Setup (verhindert leeren Raum)
        if (!window.app || !window.app.renderer || !window.app.mainScene) {
            if (window.app && typeof window.app.initEngine === 'function') {
                showVRLoader(true, 'Starte 3D Engine...');
                window.app.initEngine();
                await new Promise(resolve => setTimeout(resolve, 1500)); 
            } else {
                alert("Fehler: Engine nicht bereit.");
                return;
            }
        }

        // VR-SZENE LADEN: Wechselt das Hauptmodell auf scene.glb und entfernt alle anderen Objekte
        showVRLoader(true, 'Lade VR-Szene...');
        try {
            if (window.app.clearRoom && window.app.switchRoom) {
                window.app.clearRoom(false);
                await window.app.switchRoom('scene.glb');
            }
        } catch(e) { 
            console.warn("Laden der VR-Szene fehlgeschlagen", e); 
        }
        
        showVRLoader(true, 'VR/360° Modus wird initialisiert...');
        
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                await Promise.race([
                    DeviceOrientationEvent.requestPermission(),
                    new Promise(resolve => setTimeout(() => resolve('timeout'), 1500))
                ]);
            } catch (error) { console.warn('Gyroskop-Fehler:', error); }
        }

        enterFullscreenAndLandscape().catch(e => console.warn(e));

        const renderer = window.app.renderer;
        const camera = window.app.mainCamera;
        
        renderer.xr.enabled = true;
        
        // 2. Kamera sichern
        savedCameraState.pos.copy(camera.position);
        if (window.app.mainControls) {
            savedCameraState.target.copy(window.app.mainControls.target);
            window.app.mainControls.enabled = false; 
        }

        // 3. WebGL Visor (als ShaderMaterial fuer komplexe VR-Filter synchron zum Haupt-UI)
        if (vrFilterMesh) { camera.remove(vrFilterMesh); }
        const filterGeo = new THREE.PlaneGeometry(10, 10);
        const filterMat = new THREE.ShaderMaterial({
            transparent: true,
            depthTest: false,
            depthWrite: false,
            uniforms: {
                opacity: { value: 0.0 },
                mode: { value: 0 }, 
                severity: { value: 2.0 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float opacity;
                uniform int mode;
                uniform float severity;
                varying vec2 vUv;
                void main() {
                    vec2 center = vec2(0.5, 0.5);
                    float dist = distance(vUv, center);
                    vec4 color = vec4(0.0, 0.0, 0.0, 0.0);
                    
                    if (mode == 1) { // Tunnelblick
                        float radius = 0.4 - (severity * 0.06);
                        float alpha = smoothstep(radius, radius + 0.1, dist);
                        color = vec4(0.0, 0.0, 0.0, alpha);
                    } else if (mode == 2) { // Spot/Zentralausfall
                        float radius = 0.05 + (severity * 0.04);
                        float alpha = 1.0 - smoothstep(radius, radius + 0.1, dist);
                        color = vec4(0.0, 0.0, 0.0, alpha);
                    } else if (mode == 3) { // Grauer Star
                        color = vec4(0.83, 0.72, 0.45, opacity);
                    } else if (mode == 4) { // Gruener Star
                        float radius = 0.5 - (severity * 0.05);
                        float alpha = smoothstep(radius, radius + 0.2, dist);
                        color = vec4(0.0, 0.0, 0.0, max(alpha, opacity * 0.5));
                    } else if (mode == 6) { // Blindheit
                        color = vec4(0.0, 0.0, 0.0, opacity);
                    }
                    gl_FragColor = color;
                }
            `
        });
        vrFilterMesh = new THREE.Mesh(filterGeo, filterMat);
        vrFilterMesh.position.z = -0.1; // Direkt vor die Kameralinse
        vrFilterMesh.renderOrder = 9999;
        camera.add(vrFilterMesh);
        window.app.mainScene.add(camera);

        // 4. AUTO-AVATAR & Perspektive setzen
        let avatarObj = null;
        window.app.mainScene.traverse((child) => {
            if (child.userData && child.userData.isAvatar) avatarObj = child;
        });
        
        // Wenn kein Avatar da ist, spawnen wir ihn automatisch im Hintergrund
        if (!avatarObj && window.app.addFurniture) {
            await window.app.addFurniture('avatar_procedural');
            window.app.mainScene.traverse((child) => {
                if (child.userData && child.userData.isAvatar) avatarObj = child;
            });
        }

        // Kamera tief fixieren (0.6) und Avatar unsichtbar machen!
        let startPos = new THREE.Vector3(0, 0.6, 0); 
        if (avatarObj) {
            if (avatarObj.userData && avatarObj.userData.visualRef) {
                avatarObj.userData.visualRef.visible = false;
            }
            startPos.copy(avatarObj.position);
            startPos.y += 0.6; 
        }
        camera.position.copy(startPos);

        // STRIKTE KONTROLLE: Zoomen und Wischen komplett deaktivieren!
        if (window.app.mainControls) {
            window.app.mainControls.enabled = false;
            window.app.mainControls.enableZoom = false;
            window.app.mainControls.enablePan = false;
            window.app.mainControls.enableRotate = false;
        }

        // 5. Gyroskop aktivieren
        try {
            vrControls = new DeviceOrientationControls(camera);
        } catch(e) {
            console.warn("DeviceOrientationControls Fallback:", e);
            vrControls = null;
        }

        // 6. Neues VR UI aufbauen
        toggleMainUI(false);
        const overlay = document.getElementById('vr-overlay');
        if (overlay) overlay.style.display = 'block';

        initOverlayListeners();
        buildVRMenu();

        // 7. Render-Loop starten
        const renderVR = () => {
            if (vrControls && !renderer.xr.isPresenting) {
                vrControls.update();
            }
            renderer.render(window.app.mainScene, camera);
        };

        renderer.setAnimationLoop(renderVR);
        isActive = true;
        
        // 8. WebXR Button generieren
        injectVRButtonStyle();
        try {
            const oldBtn = document.getElementById('webxr-btn');
            if(oldBtn) oldBtn.remove();

            const vrBtn = VRButton.createButton(renderer);
            vrBtn.id = 'webxr-btn';
            vrBtn.style.position = 'absolute';
            vrBtn.style.left = '50%';
            vrBtn.style.transform = 'translateX(-50%)';
            vrBtn.style.pointerEvents = 'auto'; 
            vrBtn.style.zIndex = '999999';
            if (overlay) overlay.appendChild(vrBtn);

            // Text exakt auf "VR" kürzen
            setTimeout(() => {
                const btn = document.getElementById('webxr-btn');
                if (btn) {
                    if (btn.innerText.toLowerCase().includes('enter vr') || btn.innerText.toLowerCase().includes('vr')) {
                        btn.innerText = 'VR';
                    }
                    if (btn.disabled || btn.innerText.toLowerCase().includes('supported')) {
                        btn.style.display = 'none';
                    }
                }
            }, 500);
        } catch(e) { console.error("VRButton Error:", e); }

        showVRLoader(false);

    } catch(globalError) {
        console.error("VR Start Error:", globalError);
        showVRLoader(false);
    }
}

export function stopVRMode() {
    if (!isActive) return;
    isActive = false;
    window.app.vrIsActive = false;

    const vrBtn = document.getElementById('webxr-btn');
    if (vrBtn) vrBtn.remove();

    const renderer = window.app.renderer;
    const camera = window.app.mainCamera;

    // Loop zurückgeben
    renderer.setAnimationLoop(window.app.mainAnimate);
    
    if (vrControls) {
        vrControls.dispose();
        vrControls = null;
    }

    // Visor entfernen
    if (vrFilterMesh) {
        camera.remove(vrFilterMesh);
        vrFilterMesh.geometry.dispose();
        vrFilterMesh.material.dispose();
        vrFilterMesh = null;
    }
    if (window.app.mainScene.fog) window.app.mainScene.fog.density = 0;

    // Avatar wieder sichtbar machen fuer den Planer
    if (window.app.mainScene) {
        window.app.mainScene.traverse((child) => {
            if (child.userData && child.userData.isAvatar && child.userData.visualRef) {
                child.userData.visualRef.visible = true;
            }
        });
    }

    // Kamera & Controls vollstaendig wiederherstellen
    camera.position.copy(savedCameraState.pos);
    if (window.app.mainControls) {
        window.app.mainControls.target.copy(savedCameraState.target);
        window.app.mainControls.enabled = true;
        window.app.mainControls.enableZoom = true;
        window.app.mainControls.enablePan = true;
        window.app.mainControls.enableRotate = true;
        window.app.mainControls.update();
    }

    if (document.fullscreenElement) document.exitFullscreen().catch(()=>{});
    else if (document.webkitFullscreenElement) document.webkitExitFullscreen().catch(()=>{});
    if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();

    const overlay = document.getElementById('vr-overlay');
    if (overlay) {
        overlay.style.display = 'none';
        overlay.style.pointerEvents = ''; 
    }
    
    document.body.className = document.body.className.replace(/sim-[^\s]+/g, '').trim();
    
    toggleMainUI(true);
    window.dispatchEvent(new Event('resize'));
}

window.addEventListener('resize', () => {
    if (isActive && window.app.mainCamera && window.app.renderer) {
        window.app.mainCamera.aspect = window.innerWidth / window.innerHeight;
        window.app.mainCamera.updateProjectionMatrix();
        window.app.renderer.setSize(window.innerWidth, window.innerHeight);
    }
});