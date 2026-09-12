/**
 * ============================================================================
 * CONFIGURATION DE L'APPLICATION
 * ============================================================================
 */
const CONFIG = {
    // Remplacer par l'URL de l'exécutable Web de ton Google Apps Script
    GAS_URL: "https://script.google.com/macros/s/AKfycbx_06ZxdUanydJOp_HcdcMR7yvCQB_PSewpZpCoKCxKW0d3ojk3-f-hr1h3cMtIwZ2f/exec",
    TOKEN: "123veille456STS", // Doit correspondre au token du Code.gs
    ITEMS_PER_PAGE: 12
};

/**
 * ============================================================================
 * ÉTAT DE L'APPLICATION (STATE)
 * ============================================================================
 */
let AppState = {
    resources: [],
    filtered: [],
    currentPage: 1,
    lang: 'FR',
    keywords: { fr: [], en: [] }, // Stockage croisé par index
    filters: {
        search: '', niveau: '', theme: '', type: '', langues: [], contributor: '', school: ''
    }
};

/**
 * ============================================================================
 * INITIALISATION & GESTION DE LA LANGUE
 * ============================================================================
 */
document.addEventListener('DOMContentLoaded', () => {
    initLangSwitch();
    initModals();
    initTabs();
    initFormInteractions();
    
    // Lire l'URL au démarrage
    parseURLParams();
    
    // Charger les données
    loadResources();
});

function initLangSwitch() {
    const langToggle = document.getElementById('lang-toggle');
    
    // Synchroniser avec l'URL ou FR par défaut
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('lang') === 'EN') {
        langToggle.checked = true;
        AppState.lang = 'EN';
    }
    document.body.setAttribute('data-lang', AppState.lang);

    langToggle.addEventListener('change', (e) => {
        AppState.lang = e.target.checked ? 'EN' : 'FR';
        document.body.setAttribute('data-lang', AppState.lang);
        updateURL();
        renderGrid(); // Re-render pour adapter les textes dynamiques (titres, badges types)
    });
}

/**
 * ============================================================================
 * CHARGEMENT ET PARSAGE DES DONNÉES (GET)
 * ============================================================================
 */
async function loadResources() {
    const grid = document.getElementById('resources-grid');
    grid.innerHTML = '<p class="loading">Chargement des ressources / Loading resources...</p>';

    // Utilisation du sessionStorage pour éviter les requêtes à chaque rechargement
    const cachedData = sessionStorage.getItem('veilles_resources');
    
    if (cachedData) {
        AppState.resources = JSON.parse(cachedData);
        applyFilters();
    } else {
        try {
            const response = await fetch(`${CONFIG.GAS_URL}?action=get_resources`);
            const json = await response.json();
            
            if (json.success) {
                AppState.resources = json.data;
                sessionStorage.setItem('veilles_resources', JSON.stringify(json.data));
                populateFilterDropdowns(); // Remplit les options dynamiquement
                applyFilters();
            } else {
                throw new Error("Erreur serveur");
            }
        } catch (error) {
            grid.innerHTML = `<p style="color:red;">Erreur de connexion à la base de données. / Database connection error.</p>`;
            console.error(error);
        }
    }
}

/**
 * ============================================================================
 * MOTEUR DE FILTRAGE ET URL
 * ============================================================================
 */
function parseURLParams() {
    const params = new URLSearchParams(window.location.search);
    AppState.filters.search = params.get('q') || '';
    AppState.filters.niveau = params.get('niveau') || '';
    AppState.filters.theme = params.get('theme') || '';
    AppState.filters.type = params.get('type') || '';
    AppState.filters.contributor = params.get('contributor') || '';
    AppState.filters.school = params.get('school') || '';
    
    const langs = params.get('langues');
    AppState.filters.langues = langs ? langs.split(',') : [];

    // Pré-remplir les inputs HTML (à lier avec la structure HTML existante)
    document.getElementById('search-input').value = AppState.filters.search;
    document.getElementById('search-input-en').value = AppState.filters.search;
    // Note: Pour les <select>, la sélection se fera après populateFilterDropdowns()
}

function updateURL() {
    const params = new URLSearchParams();
    params.set('lang', AppState.lang);
    if (AppState.filters.search) params.set('q', AppState.filters.search);
    if (AppState.filters.niveau) params.set('niveau', AppState.filters.niveau);
    if (AppState.filters.theme) params.set('theme', AppState.filters.theme);
    if (AppState.filters.type) params.set('type', AppState.filters.type);
    if (AppState.filters.contributor) params.set('contributor', AppState.filters.contributor);
    if (AppState.filters.school) params.set('school', AppState.filters.school);
    if (AppState.filters.langues.length) params.set('langues', AppState.filters.langues.join(','));

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
}

function applyFilters() {
    AppState.filtered = AppState.resources.filter(item => {
        // Logique de filtrage textuel global
        if (AppState.filters.search) {
            const term = AppState.filters.search.toLowerCase();
            const textToSearch = `${item.titre} ${item.mots_cles} ${item.keywords} ${item.theme} ${item.topic}`.toLowerCase();
            if (!textToSearch.includes(term)) return false;
        }
        
        // Logique exacte
        if (AppState.filters.niveau && !item.niveau.includes(AppState.filters.niveau)) return false;
        if (AppState.filters.theme && !item.theme.includes(AppState.filters.theme) && !item.topic.includes(AppState.filters.theme)) return false;
        if (AppState.filters.type && item.type_fr !== AppState.filters.type && item.type_en !== AppState.filters.type) return false;
        if (AppState.filters.contributor && item.propose_par !== AppState.filters.contributor) return false;
        if (AppState.filters.school && item.etablissement !== AppState.filters.school) return false;
        
        // Filtrage des langues (sélection multiple)
        if (AppState.filters.langues.length > 0) {
            if (!AppState.filters.langues.includes(item.langue)) return false;
        }
        return true;
    });

    AppState.currentPage = 1;
    renderGrid();
}

/**
 * ============================================================================
 * AFFICHAGE DES CARTES ET PAGINATION
 * ============================================================================
 */
function renderGrid() {
    const grid = document.getElementById('resources-grid');
    const btnLoadMore = document.getElementById('btn-load-more');
    grid.innerHTML = '';

    if (AppState.filtered.length === 0) {
        grid.innerHTML = `<p>Aucune ressource trouvée / No resources found.</p>`;
        btnLoadMore.style.display = 'none';
        return;
    }

    const itemsToShow = AppState.filtered.slice(0, AppState.currentPage * CONFIG.ITEMS_PER_PAGE);
    
    itemsToShow.forEach(item => {
        grid.appendChild(createCardHTML(item));
    });

    // Afficher/Masquer le bouton "Afficher plus"
    btnLoadMore.style.display = (AppState.currentPage * CONFIG.ITEMS_PER_PAGE < AppState.filtered.length) ? 'block' : 'none';
}

function createCardHTML(item) {
    const card = document.createElement('article');
    card.className = 'card';
    
    // Sécurisation des images avec fallback
    const imgUrl = item.image ? item.image : 'default-image.jpg'; 
    
    // Génération des badges de thèmes
    const themesFR = item.theme ? item.theme.split(',').map(t => t.trim()) : [];
    const themesEN = item.topic ? item.topic.split(',').map(t => t.trim()) : [];
    const themesToUse = AppState.lang === 'FR' ? themesFR : themesEN;
    
    // Détermination de la couleur (simplifié, idéalement lié à un mapping de structure)
    const niveauClass = item.niveau ? `bg-niveau-${item.niveau.split(',')[0].trim().toLowerCase()}` : 'bg-niveau-all';

    let badgesHTML = themesToUse.map(theme => `
        <span class="badge ${niveauClass} badge-icone">
            <svg><use href="#flask"></use></svg> <!-- Remplacer #flask par l'icône du thème réel -->
            ${theme}
        </span>
    `).join('');

    const typeToUse = AppState.lang === 'FR' ? item.type_fr : item.type_en;

    card.innerHTML = `
        <img src="${imgUrl}" alt="${item.titre}" class="card-img" onerror="this.src='default-image.jpg';">
        <div class="card-content">
            <div class="badges-container">
                ${badgesHTML}
            </div>
            <a href="${item.url}" target="_blank" class="card-title">${item.titre}</a>
            <div class="badges-container" style="margin-top: 0.5rem;">
                <span class="badge badge-type">${typeToUse}</span>
                <span class="badge badge-lang">${item.langue}</span>
            </div>
            <div class="card-meta">
                <span>${item.propose_par} (${item.etablissement})</span>
                <button class="btn-report" onclick="openReportModal()">
                    <span class="lang-fr" style="${AppState.lang === 'EN' ? 'display:none;' : ''}">Signaler un lien mort</span>
                    <span class="lang-en" style="${AppState.lang === 'FR' ? 'display:none;' : ''}">Report broken link</span>
                </button>
            </div>
        </div>
    `;
    return card;
}

// Bouton "Afficher plus"
document.getElementById('btn-load-more').addEventListener('click', () => {
    AppState.currentPage++;
    renderGrid();
});

/**
 * ============================================================================
 * GESTION DES MODALES ET ONGLETS
 * ============================================================================
 */
function initModals() {
    const modals = {
        add: document.getElementById('modal-add'),
        about: document.getElementById('modal-about'),
        report: document.getElementById('modal-report')
    };

    // Boutons d'ouverture
    document.getElementById('btn-open-add-modal').addEventListener('click', () => modals.add.classList.remove('hidden'));
    document.getElementById('link-about').addEventListener('click', (e) => { e.preventDefault(); modals.about.classList.remove('hidden'); });
    
    // Fermeture globale (boutons X et clics en dehors)
    document.querySelectorAll('.close-modal, .btn-close-report').forEach(btn => {
        btn.addEventListener('click', (e) => e.target.closest('.modal').classList.add('hidden'));
    });
}

function openReportModal() {
    document.getElementById('modal-report').classList.remove('hidden');
}

function initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.target).classList.add('active');
        });
    });
}

/**
 * ============================================================================
 * FORMULAIRE D'AJOUT & IA GEMINI
 * ============================================================================
 */
function initFormInteractions() {
    // 1. Bouton d'Analyse IA
    const btnAnalyze = document.getElementById('btn-analyze-ia');
    const loadingText = document.getElementById('ia-loading-text');
    const errorAlert = document.getElementById('ia-error-alert');

    btnAnalyze.addEventListener('click', async () => {
        const urlInput = document.getElementById('ia-url-input').value;
        if (!urlInput) return;

        btnAnalyze.disabled = true;
        loadingText.classList.remove('hidden');
        errorAlert.classList.add('hidden');

        try {
            const res = await fetch(`${CONFIG.GAS_URL}?action=analyze_url&url=${encodeURIComponent(urlInput)}&token=${CONFIG.TOKEN}`);
            const json = await res.json();

            if (json.success) {
                const data = json.data;
                if (data.est_pertinent === false) {
                    // IA rejette
                    document.getElementById('ia-reason-fr').innerText = data.motif_rejet_fr;
                    document.getElementById('ia-reason-en').innerText = data.motif_rejet_en;
                    errorAlert.classList.remove('hidden');
                } else {
                    // IA valide : préremplissage et basculement vers onglet manuel
                    fillFormWithIA(data, urlInput);
                    document.querySelector('.tab-btn[data-target="tab-manual"]').click();
                }
            }
        } catch (error) {
            console.error("Erreur IA", error);
            alert("Erreur de communication avec l'IA.");
        } finally {
            btnAnalyze.disabled = false;
            loadingText.classList.add('hidden');
        }
    });

    // 2. Gestion de l'image (Aperçu et Fallback)
    const imgInput = document.getElementById('form-image');
    const imgPreview = document.getElementById('image-preview');
    
    document.getElementById('btn-preview-image').addEventListener('click', () => {
        if (imgInput.value) {
            imgPreview.src = imgInput.value;
            imgPreview.classList.remove('hidden');
        }
    });

    // 3. Gestion dynamique du select "Autre"
    document.getElementById('form-type').addEventListener('change', (e) => {
        const newTypeContainer = document.getElementById('new-type-container');
        if (e.target.value === 'autre') {
            newTypeContainer.classList.remove('hidden');
        } else {
            newTypeContainer.classList.add('hidden');
        }
    });

    // 4. Gestion des mots clés (Suppression croisée par index)
    setupKeywordsLogic();

    // 5. Soumission du formulaire (Optimisme UI / )
    document.getElementById('resource-form').addEventListener('submit', handleFormSubmit);
}

function fillFormWithIA(data, url) {
    document.getElementById('form-url').value = url;
    document.getElementById('form-title').value = data.titre || "";
    document.getElementById('form-image').value = data.image || "";
    if (data.image) document.getElementById('btn-preview-image').click();
    
    // Mots clés
    AppState.keywords.fr = data.mots_cles || [];
    AppState.keywords.en = data.keywords || [];
    renderKeywords();
}

/**
 * ============================================================================
 * LOGIQUE AVANCÉE : MOTS-CLÉS CROISÉS
 * ============================================================================
 */
function setupKeywordsLogic() {
    const btnFr = document.getElementById('btn-add-keyword-fr');
    const btnEn = document.getElementById('btn-add-keyword-en');
    const inputFr = document.getElementById('input-keyword-fr');
    const inputEn = document.getElementById('input-keyword-en');

    // On force l'ajout par paire
    const addPair = () => {
        const valFr = inputFr.value.trim();
        const valEn = inputEn.value.trim();
        if (valFr && valEn) {
            AppState.keywords.fr.push(valFr);
            AppState.keywords.en.push(valEn);
            inputFr.value = '';
            inputEn.value = '';
            renderKeywords();
        } else {
            alert(AppState.lang === 'FR' ? "Veuillez remplir les deux champs." : "Please fill both fields.");
        }
    };

    btnFr.addEventListener('click', addPair);
    btnEn.addEventListener('click', addPair);
}

function renderKeywords() {
    const containerFr = document.getElementById('keywords-fr-container');
    const containerEn = document.getElementById('keywords-en-container');
    
    containerFr.innerHTML = '';
    containerEn.innerHTML = '';

    AppState.keywords.fr.forEach((word, index) => {
        const wordEn = AppState.keywords.en[index];
        
        containerFr.innerHTML += `<span class="tag">${word} <span class="tag-remove" onclick="removeKeywordPair(${index})">×</span></span>`;
        containerEn.innerHTML += `<span class="tag">${wordEn} <span class="tag-remove" onclick="removeKeywordPair(${index})">×</span></span>`;
    });
}

// Fonction globale appelée par le onClick des tags
window.removeKeywordPair = function(index) {
    AppState.keywords.fr.splice(index, 1);
    AppState.keywords.en.splice(index, 1);
    renderKeywords();
}

/**
 * ============================================================================
 * SOUMISSION DU FORMULAIRE (OPTIMISME UI)
 * ============================================================================
 */
function handleFormSubmit(e) {
    e.preventDefault();
    const btnSubmit = document.getElementById('btn-submit-resource');
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = AppState.lang === 'FR' ? "Envoi en cours..." : "Sending...";

    // Collecte des données
    const payload = {
        token: CONFIG.TOKEN,
        data: {
            url: document.getElementById('form-url').value,
            titre: document.getElementById('form-title').value,
            image: document.getElementById('form-image').value,
            mots_cles: AppState.keywords.fr,
            keywords: AppState.keywords.en,
            langue: document.getElementById('form-lang').value,
            propose_par: document.getElementById('form-name').value,
            etablissement: document.getElementById('form-school').value,
            // Si c'est "autre", on prend les champs textes, sinon on prend la valeur du select
            type_fr: document.getElementById('form-type').value === 'autre' ? document.getElementById('new-type-fr').value : document.getElementById('form-type').value,
            type_en: document.getElementById('form-type').value === 'autre' ? document.getElementById('new-type-en').value : "" 
            // Note: Les niveaux et thèmes nécessiteront de lire les tableaux générés dynamiquement (non exhaustif ici pour éviter un code illisible).
        }
    };

    // Envoi Fire-and-Forget (no-cors)
    fetch(CONFIG.GAS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
    }).catch(err => console.log("L'erreur CORS est normale ici en mode opaque", err));

    // Optimisme UI : On simule la réussite après 1.5 secondes
    setTimeout(() => {
        document.getElementById('modal-add').classList.add('hidden');
        document.getElementById('resource-form').reset();
        AppState.keywords = { fr: [], en: [] };
        renderKeywords();
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = AppState.lang === 'FR' ? "Soumettre la ressource" : "Submit resource";
        
        // Afficher le Toast
        const toast = document.getElementById('toast-notification');
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 4000);
    }, 1500);
}
