const GAS_URL = "https://script.google.com/macros/s/AKfycbx_06ZxdUanydJOp_HcdcMR7yvCQB_PSewpZpCoKCxKW0d3ojk3-f-hr1h3cMtIwZ2f/exec"; 
let allResources = [];
let currentIndex = 0;
const ITEMS_PER_PAGE = 12;
let isEnglish = false;

// 1. Initialisation et synchronisation URL
document.addEventListener("DOMContentLoaded", async () => {
    initLangToggle();
    await fetchResources();
    parseUrlParams();
    renderGrid();
    setupFilters();
    setupModals();
});

function initLangToggle() {
    const toggle = document.getElementById('lang-toggle');
    toggle.addEventListener('change', (e) => {
        isEnglish = e.target.checked;
        document.querySelectorAll('.fr-text').forEach(el => el.classList.toggle('hidden', isEnglish));
        document.querySelectorAll('.en-text').forEach(el => el.classList.toggle('hidden', !isEnglish));
        updateUrlParam('lang', isEnglish ? 'EN' : 'FR');
        renderGrid(true);
    });
}

async function fetchResources() {
    try {
        const response = await fetch(`${GAS_URL}?action=getData`);
        const data = await response.json();
        allResources = data.ressources; // On suppose que GAS renvoie un JSON {ressources: [...]}
        populateFilters(data);
        document.getElementById('loading-indicator').classList.add('hidden');
    } catch (error) {
        console.error("Erreur de chargement", error);
        document.getElementById('loading-indicator').innerText = "Erreur de connexion au serveur.";
    }
}

// 2. Gestion des paramètres d'URL (replaceState)
function parseUrlParams() {
    const params = new URLSearchParams(window.location.search);
    if(params.get('lang') === 'EN') {
        document.getElementById('lang-toggle').checked = true;
        isEnglish = true;
    }
    ['niveau', 'theme', 'type', 'langue'].forEach(filter => {
        if(params.has(filter)) document.getElementById(`filter-${filter}`).value = params.get(filter);
    });
}

function updateUrlParam(key, value) {
    const url = new URL(window.location);
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
    window.history.replaceState({}, '', url);
}

function setupFilters() {
    const filters = document.querySelectorAll('.sidebar select, .sidebar input');
    filters.forEach(f => f.addEventListener('input', () => {
        updateUrlParam(f.id.replace('filter-', ''), f.value);
        renderGrid(true);
    }));
}

// 3. Affichage et filtrage 12 par 12
function renderGrid(reset = false) {
    if (reset) { currentIndex = 0; document.getElementById('resources-grid').innerHTML = ''; }
    
    let filtered = allResources.filter(res => {
        // Logique de filtrage front-end
        const search = document.getElementById('search-input').value.toLowerCase();
        const niveau = document.getElementById('filter-niveau').value;
        const theme = document.getElementById('filter-theme').value;
        
        const matchSearch = res.titre.toLowerCase().includes(search) || res.mots_cles.toLowerCase().includes(search);
        const matchNiveau = !niveau || res.niveau.includes(niveau);
        const matchTheme = !theme || res.theme.includes(theme);
        
        return matchSearch && matchNiveau && matchTheme;
    });

    const fragment = document.createDocumentFragment();
    const toShow = filtered.slice(currentIndex, currentIndex + ITEMS_PER_PAGE);
    
    toShow.forEach(res => {
        const card = document.createElement('div');
        card.className = 'card';
        // Fallback image direct dans le HTML généré via onerror
        card.innerHTML = `
            <a href="${res.url}" target="_blank">
                <img src="${res.image || 'default-image.jpg'}" alt="${res.titre}" onerror="this.onerror=null;this.src='default-image.jpg';">
                <div class="card-content">
                    <h3>${res.titre}</h3>
                    <div class="badges-container">
                        ${generateBadges(res)}
                    </div>
                </div>
            </a>
        `;
        fragment.appendChild(card);
    });

    document.getElementById('resources-grid').appendChild(fragment);
    currentIndex += ITEMS_PER_PAGE;
    
    const btnMore = document.getElementById('btn-load-more');
    if(currentIndex >= filtered.length) btnMore.classList.add('hidden');
    else { btnMore.classList.remove('hidden'); btnMore.onclick = () => renderGrid(false); }
}

function generateBadges(res) {
    // Génère les badges de thèmes, types et langues. Requiert la donnée correspondante du backend.
    let badgesHtml = '';
    const themes = res.theme.split(',');
    themes.forEach(t => {
        badgesHtml += `<span class="badge bg-niveau-${res.niveau_principal.toLowerCase().replace(' ', '')}">
            <svg><use href="#${res.icone_theme || 'default-icon'}"></use></svg>
            ${isEnglish ? res.topic : t.trim()}
        </span>`;
    });
    badgesHtml += `<span class="badge bg-type">${isEnglish ? res.type_en : res.type_fr}</span>`;
    badgesHtml += `<span class="badge">${res.langue}</span>`;
    return badgesHtml;
}

// 4. Modales & Optimisme UI (POST No-cors)
function setupModals() {
    // Code basique d'ouverture/fermeture...
    const btnSubmit = document.getElementById('btn-submit-resource');
    btnSubmit.addEventListener('click', (e) => {
        e.preventDefault();
        btnSubmit.disabled = true;
        btnSubmit.innerText = isEnglish ? "Submitting..." : "Envoi en cours...";
        
        const payload = {
            action: "addResource",
            titre: document.getElementById('f-titre').value,
            // ... autres champs
        };

        // POST NO-CORS asymétrique
        fetch(GAS_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain' }, // Exigence du CDC
            body: JSON.stringify(payload)
        }).then(() => {
            // Optimisme UI (1.5s delay simulé demandé dans le cahier des charges)
            setTimeout(() => {
                document.getElementById('modal-propose').classList.add('hidden');
                btnSubmit.disabled = false;
                btnSubmit.innerText = "Soumettre";
                showToast(isEnglish ? "Resource successfully submitted, pending moderation" : "Ressource soumise avec succès, en attente de modération");
                document.getElementById('resource-form').reset();
            }, 1500);
        }).catch(err => console.error(err));
    });
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.innerText = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 4000);
}
