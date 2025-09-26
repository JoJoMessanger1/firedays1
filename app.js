const STORAGE_KEY = 'PrivacyPlannerData';
const IV_KEY = 'PrivacyPlannerIV';
const ALGORITHM = { name: "AES-GCM", iv: new Uint8Array(12) }; 

let MASTER_KEY; 
let APP_DATA = {
    todos: [],
    sessions: [],
    notes: "",
    mood: 3
};

// ====================================================================
// I. Kernfunktionen: Verschlüsselung und Laden (Local Storage)
// ====================================================================

const Crypto = {
    deriveKey: async function(password) {
        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            "raw", encoder.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
        );
        return crypto.subtle.deriveKey(
            { name: "PBKDF2", salt: encoder.encode("privacy-planner-salt"), iterations: 100000, hash: "SHA-256" },
            keyMaterial, ALGORITHM, true, ["encrypt", "decrypt"]
        );
    },

    encrypt: async function(data, key) {
        const encoder = new TextEncoder();
        const iv = crypto.getRandomValues(new Uint8Array(12)); 
        ALGORITHM.iv = iv;

        const ciphertext = await crypto.subtle.encrypt(ALGORITHM, key, encoder.encode(data));

        const ivString = btoa(String.fromCharCode.apply(null, iv));
        localStorage.setItem(IV_KEY, ivString);

        return btoa(String.fromCharCode.apply(null, new Uint8Array(ciphertext)));
    },

    decrypt: async function(base64Ciphertext, key) {
        const ivString = localStorage.getItem(IV_KEY);
        if (!ivString) throw new Error("IV fehlt.");

        const iv = Uint8Array.from(atob(ivString), c => c.charCodeAt(0));
        ALGORITHM.iv = iv;

        const buffer = Uint8Array.from(atob(base64Ciphertext), c => c.charCodeAt(0));

        const plaintext = await crypto.subtle.decrypt(ALGORITHM, key, buffer);

        const decoder = new TextDecoder();
        return decoder.decode(plaintext);
    }
};

const APP = {
    saveData: async function() {
        if (!MASTER_KEY) return;
        
        APP_DATA.notes = document.getElementById('notes-input').value;
        APP_DATA.mood = document.getElementById('mood-slider').value;

        try {
            const encrypted = await Crypto.encrypt(JSON.stringify(APP_DATA), MASTER_KEY);
            localStorage.setItem(STORAGE_KEY, encrypted);
            document.getElementById('save-button').textContent = "✅ Gespeichert!";
            setTimeout(() => document.getElementById('save-button').textContent = "💾 Speichern", 2000);
        } catch (e) {
            alert("Speichern fehlgeschlagen! Daten möglicherweise zu groß.");
        }
    },

    loadData: async function() {
        const encrypted = localStorage.getItem(STORAGE_KEY);
        
        // Wenn keine Daten da sind (erster Start), wird die leere APP_DATA geladen
        if (!encrypted) {
            APP_DATA = { todos: [], sessions: [], notes: "", mood: 3 }; 
            return;
        }

        try {
            const decrypted = await Crypto.decrypt(encrypted, MASTER_KEY);
            APP_DATA = JSON.parse(decrypted);
            APP.renderAll();
        } catch (e) {
            // Fängt Entschlüsselungsfehler (falsches Passwort) ab
            document.getElementById('password-info').textContent = "Falsches Passwort! Bitte erneut versuchen.";
            document.getElementById('password-screen').style.display = 'block';
            document.getElementById('main-content').style.display = 'none';
            MASTER_KEY = null;
            throw new Error("Decryption Failed"); 
        }
    },

    initApp: async function() {
        const password = document.getElementById('master-password').value;
        if (!password) { alert("Bitte ein Passwort eingeben."); return; }

        const initButton = document.querySelector('#password-screen button');
        initButton.disabled = true;
        
        try {
            MASTER_KEY = await Crypto.deriveKey(password);
            await APP.loadData();
            
            // Wenn der Ladevorgang ohne Fehler abgeschlossen ist
            if (localStorage.getItem(STORAGE_KEY) === null) {
                 await APP.saveData(); // Speichert Initialdaten mit dem neuen Key
                 alert("Neues Passwort festgelegt. Ihre Daten sind nun verschlüsselt!");
            }
            
            document.getElementById('password-screen').style.display = 'none';
            document.getElementById('main-content').style.display = 'grid';

        } catch(e) { 
            console.error("Init Error:", e); 
        } finally {
             initButton.disabled = false;
        }
    },
    
    toggleMode: function() {
        const body = document.body;
        body.classList.toggle('dark-mode');
        body.classList.toggle('light-mode');
        document.getElementById('mode-toggle').textContent = body.classList.contains('dark-mode') ? "🌙" : "☀️";
    },

    renderAll: function() {
        // To-Dos
        const todoList = document.getElementById('todo-list');
        todoList.innerHTML = APP_DATA.todos.map(t => `
            <div class="task-item ${t.done ? 'done' : ''}" data-id="${t.id}">
                <span onclick="TODO.toggleDone(${t.id})">${t.text} ${t.isRecurring ? '🔄' : ''}</span>
                <button onclick="TODO.deleteTask(${t.id})">x</button>
            </div>
        `).join('');
        
        // Timer-Sessions
        const sessionLog = document.getElementById('session-log');
        sessionLog.innerHTML = APP_DATA.sessions.slice(-5).reverse().map(s => {
            const duration = Math.floor(s.durationMs / 1000);
            const minutes = String(Math.floor(duration / 60)).padStart(2, '0');
            const seconds = String(duration % 60).padStart(2, '0');
            return `<li>${s.name}: ${minutes}:${seconds}</li>`;
        }).join('');
        document.getElementById('tracked-time-count').textContent = APP_DATA.sessions.length;

        // Notizen
        document.getElementById('notes-input').value = APP_DATA.notes;

        // Mood-Slider
        const moodSlider = document.getElementById('mood-slider');
        moodSlider.value = APP_DATA.mood;
        moodSlider.dispatchEvent(new Event('input')); 
    }
};

// ====================================================================
// II. Aufgaben (To-Do List) und Mood Tracker
// ====================================================================

const TODO = {
    add: function() {
        const input = document.getElementById('todo-input');
        const text = input.value.trim();
        if (text === "") return;

        const isRecurring = confirm("Soll diese Aufgabe wöchentlich wiederholt werden (🔄)?");

        APP_DATA.todos.push({
            id: Date.now(),
            text: text,
            done: false,
            isRecurring: isRecurring
        });

        input.value = '';
        APP.renderAll();
        APP.saveData();
    },

    toggleDone: function(id) {
        const task = APP_DATA.todos.find(t => t.id === id);
        if (task) {
            task.done = !task.done;
            
            if (task.done && task.isRecurring) {
                let nextDueDate = new Date();
                nextDueDate.setDate(nextDueDate.getDate() + 7); 
                
                APP_DATA.todos.push({
                    id: Date.now(),
                    text: task.text,
                    done: false,
                    isRecurring: true
                });
            }
            
            APP.renderAll();
            APP.saveData();
        }
    },

    deleteTask: function(id) {
        APP_DATA.todos = APP_DATA.todos.filter(t => t.id !== id);
        APP.renderAll();
        APP.saveData();
    }
};

const moodSlider = document.getElementById('mood-slider');
moodSlider.addEventListener('input', () => {
    const value = moodSlider.value;
    const moodLabels = ["Sehr schlecht 😠", "Schlecht 🙁", "Neutral 😐", "Gut 🙂", "Sehr gut 😄"];
    document.getElementById('mood-output').textContent = moodLabels[value - 1] + ` (${value}/5)`;
    APP_DATA.mood = value;
});


// ====================================================================
// III. Stoppuhr Tracker mit Titel
// ====================================================================

const TIMER = {
    interval: null,
    startTime: 0,
    elapsedTime: 0,
    isRunning: false,
    
    startStop: function() {
        if (!TIMER.isRunning) {
            TIMER.startTime = Date.now() - TIMER.elapsedTime;
            TIMER.interval = setInterval(TIMER.updateDisplay, 1000);
            TIMER.isRunning = true;
            document.querySelector('.column:nth-child(2) button:nth-child(4)').textContent = 'Stopp';
        } else {
            clearInterval(TIMER.interval);
            TIMER.isRunning = false;
            document.querySelector('.column:nth-child(2) button:nth-child(4)').textContent = 'Weiter';
        }
    },
    
    updateDisplay: function() {
        TIMER.elapsedTime = Date.now() - TIMER.startTime;
        const totalSeconds = Math.floor(TIMER.elapsedTime / 1000);
        const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
        const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        document.getElementById('timer-display').textContent = `${hours}:${minutes}:${seconds}`;
    },

    saveSession: function() {
        if (TIMER.elapsedTime === 0) return;
        
        const name = document.getElementById('timer-name').value.trim();
        if (name === "") { alert("Bitte geben Sie einen Titel für die Session ein."); return; }

        clearInterval(TIMER.interval);
        
        APP_DATA.sessions.push({
            name: name,
            durationMs: TIMER.elapsedTime
        });

        TIMER.elapsedTime = 0;
        TIMER.isRunning = false;
        document.getElementById('timer-name').value = '';
        document.getElementById('timer-display').textContent = "00:00:00";
        document.querySelector('.column:nth-child(2) button:nth-child(4)').textContent = 'Start';
        
        APP.renderAll();
        APP.saveData();
    }
};

// ====================================================================
// IV. Automatisches Speichern beim Verlassen der Seite
// ====================================================================

window.addEventListener('beforeunload', () => {
    if (MASTER_KEY) {
        APP.saveData(); 
    }
});
