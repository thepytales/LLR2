window.app = window.app || {};

let audioCtx;
let masterGain, lowpassFilter, smearingGain, dryGain, analyser;
let sources = {};
let gains = {};
let isInitialized = false;

// Hilfsfunktion: Impulsantwort für Smearing (Convolver Reverb)
function createImpulseResponse(ctx, duration) {
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * duration;
    const impulse = ctx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);
    for (let i = 0; i < length; i++) {
        // Exponentieller Abfall für realistischen Hall
        const decay = Math.exp(-i / (sampleRate * (duration / 3)));
        left[i] = (Math.random() * 2 - 1) * decay;
        right[i] = (Math.random() * 2 - 1) * decay;
    }
    return impulse;
}

window.app.initAudioSim = async function() {
    if (isInitialized) return;
    isInitialized = true;

    // Audio Context initialisieren
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Master Bus Nodes
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    
    // --- NEU: Globale Filter-Variablen (damit sie im Scope erreichbar sind) ---
    window.app.highpassFilter = audioCtx.createBiquadFilter();
    window.app.highpassFilter.type = 'highpass';

    masterGain = audioCtx.createGain();
    lowpassFilter = audioCtx.createBiquadFilter();
    lowpassFilter.type = 'lowpass';
    
    // Smearing Routing (Convolver)
    const convolver = audioCtx.createConvolver();
    convolver.buffer = createImpulseResponse(audioCtx, 1.5);
    
    smearingGain = audioCtx.createGain(); // Wet Signal
    dryGain = audioCtx.createGain();      // Dry Signal
    
    // Verkabelung (Signalfluss Serie: Lowpass -> Highpass -> Split (Dry/Wet))
    lowpassFilter.connect(window.app.highpassFilter);
    
    window.app.highpassFilter.connect(dryGain);
    window.app.highpassFilter.connect(convolver);
    
    convolver.connect(smearingGain);
    
    dryGain.connect(masterGain);
    smearingGain.connect(masterGain);
    
    masterGain.connect(analyser);
    analyser.connect(audioCtx.destination);
    
    // Audio-Loader für synchrone OGGs
    const loadAudio = async (name, path) => {
        try {
            const response = await fetch(path);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            
            const source = audioCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.loop = true;
            
            const gainNode = audioCtx.createGain();
            gainNode.gain.value = 0; // Standardmäßig gemuted
            
            source.connect(gainNode);
            gainNode.connect(lowpassFilter);
            
            source.start(0);
            
            sources[name] = source;
            gains[name] = gainNode;
        } catch (e) {
            console.warn(`Fehler beim Laden der Audioquelle: ${path}`, e);
        }
    };

    // Paralleles Laden aller Spuren
    await Promise.all([
        loadAudio('speech', './audio/speech.ogg'),
        loadAudio('music', './audio/music.ogg'),
        loadAudio('noise', './audio/noise.ogg')
    ]);
    
    window.app.updateAudioEffects();
    startVisualizer();
};

window.app.toggleAudioSource = function(name) {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    if (gains[name]) {
        const current = gains[name].gain.value;
        const isMuted = current < 0.5;
        
        gains[name].gain.setTargetAtTime(isMuted ? 1 : 0, audioCtx.currentTime, 0.05);
        
        const btn = document.getElementById(`btn-audio-${name}`);
        if (btn) {
            if (isMuted) {
                btn.style.opacity = '1';
                btn.style.background = btn.style.color.replace(')', ', 0.2)').replace('rgb', 'rgba'); // Stärkerer Hintergrund
                btn.style.boxShadow = `0 4px 15px ${btn.style.color.replace(')', ', 0.3)').replace('rgb', 'rgba')}`;
            } else {
                btn.style.opacity = '0.5';
                btn.style.background = btn.style.color.replace(')', ', 0.1)').replace('rgb', 'rgba'); // Leichter Hintergrund
                btn.style.boxShadow = 'none';
            }
        }
    }
};

window.app.updateAudioEffects = function() {
    if (!audioCtx) return;
    
    const volVal = parseInt(document.getElementById('sim-audio-volume')?.value || "0");
    const freqVal = parseInt(document.getElementById('sim-audio-freq')?.value || "0");
    const lowVal = parseInt(document.getElementById('sim-audio-low')?.value || "0");
    const smearVal = parseInt(document.getElementById('sim-audio-smear')?.value || "0");
    
    // Update Text Labels in UI
    const labels = ["Keiner", "Leicht", "Mittel", "Stark"];
    const labelsSmear = ["Klar", "Leicht verschwommen", "Mittel", "Breiig"];
    
    const lblVol = document.getElementById('val-vol');
    if(lblVol) lblVol.innerText = labels[volVal];
    
    const lblFreq = document.getElementById('val-freq');
    if(lblFreq) lblFreq.innerText = labels[freqVal];

    const lblLow = document.getElementById('val-low');
    if(lblLow) lblLow.innerText = labels[lowVal];
    
    const lblSmear = document.getElementById('val-smear');
    if(lblSmear) lblSmear.innerText = labelsSmear[smearVal];

    // Lautstärke Mapping
    const volMap = [1.0, 0.5, 0.1, 0.01];
    masterGain.gain.setTargetAtTime(volMap[volVal], audioCtx.currentTime, 0.1);
    
    // Hochtonverlust (Lowpass) Mapping
    const freqMap = [20000, 4000, 2000, 1000];
    lowpassFilter.frequency.setTargetAtTime(freqMap[freqVal], audioCtx.currentTime, 0.1);

    // Tieftonverlust (Highpass) Mapping - Schneidet alles unterhalb dieser Frequenz ab
    const lowMap = [0, 300, 600, 1200];
    if(window.app.highpassFilter) {
        window.app.highpassFilter.frequency.setTargetAtTime(lowMap[lowVal], audioCtx.currentTime, 0.1);
    }
    
    // Frequenzauflösung / Smearing (Wet/Dry Mix)
    const smearMap = [0, 0.3, 0.6, 1.0];
    const dryMap = [1.0, 0.8, 0.6, 0.4];
    smearingGain.gain.setTargetAtTime(smearMap[smearVal], audioCtx.currentTime, 0.1);
    dryGain.gain.setTargetAtTime(dryMap[smearVal], audioCtx.currentTime, 0.1);
};

function startVisualizer() {
    const canvas = document.getElementById('audio-visualizer');
    if (!canvas) return;
    const canvasCtx = canvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    function draw() {
        requestAnimationFrame(draw);
        
        // Sicherheits-Check gegen GPU-Crashes bei versteckten Elementen
        if (canvas.width === 0 || canvas.height === 0 || canvas.offsetParent === null) return;

        analyser.getByteFrequencyData(dataArray);
        
        canvasCtx.fillStyle = 'rgba(26, 27, 30, 0.8)';
        canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
        
        const barWidth = (canvas.width / bufferLength) * 2.5;
        let barHeight;
        let x = 0;
        
        for(let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i] / 2;
            
            canvasCtx.fillStyle = `rgb(${barHeight + 100}, 85, 247)`;
            canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            
            x += barWidth + 1;
        }
    }
    draw();
}

window.app.closeAudioSim = function() {
    const modal = document.getElementById('audio-sim-modal');
    if (modal) modal.style.display = 'none';
    
    // Audio Context pausieren, damit nichts im Hintergrund weiterläuft
    if (audioCtx && audioCtx.state === 'running') {
        audioCtx.suspend();
    }
};

window.app.resumeAudioSim = function() {
    // Audio Context wieder starten, wenn das Modal geöffnet wird
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
};