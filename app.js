/**
 * app.js
 *
 * Gère l'intégralité du frontend :
 *   1. Switch de langue FR/EN (texte de l'interface, persistance URL ?lang=)
 *   2. Modales (À propos, Signaler un problème, Proposer une ressource,
 *      confirmation d'enregistrement) — ouverture/fermeture/réinitialisation
 *   3. Sidebar mobile (empilement < 768px)
 *   4. Onglets de la modale "Proposer une ressource"
 *   5. Chargement des données réelles (action=getData) + affichage des
 *      cartes-ressources, paginé 12 par 12 ("Afficher plus")
 *   6. Les 8 filtres à facettes dynamiques généralisées : chaque filtre ne
 *      propose que les options compatibles avec les 7 autres, recalculé à
 *      chaque changement ; thème en logique ET, langue/mots-clés en OU ;
 *      persistance de l'état des filtres dans l'URL
 *   7. Modale "Proposer une ressource" à 3 chemins :
 *      - Analyse IA par URL (appel à analyzeUrl, gestion du rejet IA)
 *      - Import externe (génération d'un prompt à coller dans une IA au
 *        choix de l'enseignant, collage du JSON obtenu, validation contre
 *        le référentiel réalisée côté client puisque ce résultat n'a jamais
 *        transité par notre backend)
 *      - Ajout manuel (formulaire vide)
 *      Les 3 chemins convergent vers un formulaire de relecture partagé
 *      (form-ia) ou le formulaire manuel (form-manuel), avec saisie de
 *      mots-clés en étiquettes et gestion des indicateurs *_reconnu.
 *
 * Ce fichier suppose que TOKEN_FRONTEND (section 7) contient la vraie
 * valeur de API_SECRET_TOKEN — sinon toute analyse IA et tout enregistrement
 * échouent silencieusement (POST en no-cors, jamais d'erreur visible).
 */

(function () {
  "use strict";

  /* =======================================================
     0. ÉTAT PARTAGÉ (déclaré en premier : utilisé dès la section langue)
     ======================================================= */
  let donneesChargees = false;

  // Données brutes reçues une seule fois au chargement, jamais re-fetchées
  // lors du filtrage (qui doit rester exclusivement local, cf. CDC).
  let toutesLesRessources = [];
  let referentielStructure = [];
  let referentielTypes = [];
  let referentielLangues = [];

  let ressourcesAffichees = [];
  let nombreCartesVisibles = 0;

  // État courant des 8 filtres. Valeur unique (chaîne) pour les menus
  // déroulants à choix unique ; Set pour les catégories multi-sélection
  // (OU à l'intérieur d'une catégorie, ET entre catégories différentes).
  const filtres = {
    recherche: "",
    niveau: "",
    themes: new Set(),
    type: "",
    langues: new Set(),
    proposePar: "",
    etablissement: "",
    motsCles: new Set()
  };

  /* =======================================================
     1. GESTION DE LA LANGUE (FR / EN)
     ======================================================= */
  const langToggle = document.getElementById("lang-toggle");
  const htmlEl = document.documentElement;

  function applyLang(lang) {
    htmlEl.setAttribute("data-lang", lang);
    htmlEl.setAttribute("lang", lang === "EN" ? "en" : "fr");
    langToggle.setAttribute("aria-checked", lang === "EN" ? "true" : "false");

    // Textes simples portés par data-fr / data-en
    document.querySelectorAll("[data-fr][data-en]").forEach((el) => {
      el.textContent = lang === "EN" ? el.dataset.en : el.dataset.fr;
    });

    // Placeholders portés par data-fr-placeholder / data-en-placeholder
    document.querySelectorAll("[data-fr-placeholder][data-en-placeholder]").forEach((el) => {
      el.setAttribute(
        "placeholder",
        lang === "EN" ? el.dataset.enPlaceholder : el.dataset.frPlaceholder
      );
    });

    // Blocs entiers bilingues (ex : modale "À propos")
    document.querySelectorAll("[data-lang-block]").forEach((el) => {
      el.hidden = el.getAttribute("data-lang-block") !== lang;
    });

    // Persistance dans l'URL (history.replaceState, comme exigé par le CDC)
    const params = new URLSearchParams(window.location.search);
    params.set("lang", lang);
    history.replaceState(null, "", "?" + params.toString());

    // Le filtre mots-clés dépend de la langue (vocabulaire différent, pas
    // une simple traduction d'étiquette) : on le réinitialise et on
    // recalcule ses options disponibles, puis on ré-applique les filtres.
    // Ignoré tant que les données n'ont pas encore été chargées.
    if (donneesChargees) {
      filtres.motsCles.clear();
      actualiserOptionsMotsCles_();
      appliquerFiltres_();
    }
  }

  langToggle.addEventListener("click", () => {
    if (donneesChargees && filtres.motsCles.size > 0) {
      const langActuelle = htmlEl.getAttribute("data-lang") === "EN" ? "EN" : "FR";
      const message = langActuelle === "EN"
        ? "Changing language will clear your selected keywords. Continue?"
        : "Changer de langue effacera votre sélection de mots-clés. Continuer ?";
      if (!window.confirm(message)) return;
    }
    const current = htmlEl.getAttribute("data-lang") === "EN" ? "EN" : "FR";
    applyLang(current === "EN" ? "FR" : "EN");
  });

  // Lecture initiale de l'URL au chargement (?lang=EN)
  const initialParams = new URLSearchParams(window.location.search);
  const initialLang = initialParams.get("lang") === "EN" ? "EN" : "FR";
  applyLang(initialLang);

  /* =======================================================
     2. GESTION DES MODALES
     ======================================================= */
  function openModal(modalEl) {
    modalEl.hidden = false;
  }
  function closeModal(modalEl) {
    modalEl.hidden = true;
  }

  const modalAbout = document.getElementById("modal-about");
  const modalReport = document.getElementById("modal-report");
  const modalAddResource = document.getElementById("modal-add-resource");

  document.getElementById("btn-open-about").addEventListener("click", () => openModal(modalAbout));
  document.getElementById("btn-open-add-resource").addEventListener("click", () => {
    if (typeof reinitialiserModaleAjout_ === "function") reinitialiserModaleAjout_();
    openModal(modalAddResource);
  });

  // Un bouton "Signaler un problème" par carte (démo actuelle + cartes futures)
  document.addEventListener("click", (event) => {
    if (event.target.closest(".btn-open-report")) {
      openModal(modalReport);
    }
  });

  // Fermeture : bouton dédié, clic sur l'overlay, ou touche Échap
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeModal(btn.closest(".modal-overlay"));
    });
  });

  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeModal(overlay);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      document.querySelectorAll(".modal-overlay:not([hidden])").forEach(closeModal);
    }
  });

  /* =======================================================
     3. SIDEBAR MOBILE (empilement < 768px)
     ======================================================= */
  const sidebarToggle = document.getElementById("sidebar-mobile-toggle");
  const sidebarContent = document.getElementById("sidebar-content");

  sidebarToggle.addEventListener("click", () => {
    const isCollapsed = sidebarContent.getAttribute("data-collapsed") === "true";
    sidebarContent.setAttribute("data-collapsed", isCollapsed ? "false" : "true");
    sidebarToggle.setAttribute("aria-expanded", isCollapsed ? "true" : "false");
  });

  // Sur mobile, la sidebar démarre repliée ; sur desktop, toujours visible.
  function initSidebarState() {
    if (window.innerWidth < 768) {
      sidebarContent.setAttribute("data-collapsed", "true");
    } else {
      sidebarContent.removeAttribute("data-collapsed");
    }
  }
  initSidebarState();
  window.addEventListener("resize", initSidebarState);

  /* =======================================================
     4. ONGLETS DE LA MODALE "PROPOSER UNE RESSOURCE"
     ======================================================= */
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => {
        t.classList.remove("tab--active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("tab--active");
      tab.setAttribute("aria-selected", "true");

      const targetName = tab.dataset.tab;
      document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
        panel.hidden = panel.getAttribute("data-tab-panel") !== targetName;
      });

      // form-ia est partagé entre les onglets "ia" et "import" mais vit hors
      // des panneaux : on le masque à chaque changement d'onglet, les deux
      // flux (Analyser / Charger) le réafficheront eux-mêmes le moment venu.
      document.getElementById("form-ia").hidden = true;
    });
  });
  /* =======================================================
     5. CHARGEMENT DES DONNÉES (backend Code.gs, action=getData)
     ======================================================= */
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxD8Hf1muql7BF0qiDMlpfV038afKdIco3dIsVNwGLgyg8Ct-DoEM4fhK1ItlDg30zd/exec";
  const TAILLE_PAGE = 12; // Affichage 12 par 12, exigé par le CDC

  const grille = document.getElementById("card-grid");
  const compteurResultats = document.getElementById("result-count-number");
  const boutonAfficherPlus = document.getElementById("btn-load-more");

  function chargerDonnees(tentative) {
    tentative = tentative || 1;

    fetch(APPS_SCRIPT_URL + "?action=getData")
      .then(function (reponse) { return reponse.json(); })
      .then(function (donnees) {
        if (donnees.erreur) throw new Error(donnees.erreur);

        toutesLesRessources = donnees.ressources || [];
        referentielStructure = donnees.structure || [];
        referentielTypes = donnees.types || [];
        referentielLangues = donnees.langues || [];
        donneesChargees = true;

        restaurerFiltresDepuisUrl_();
        rafraichirToutesLesFacettes_();
        appliquerFiltres_();
        construireFormulaire_(formIA);
        construireFormulaire_(formManuel);
      })
      .catch(function (erreur) {
        // Aléa ponctuel côté infrastructure Google (réponse non-JSON, etc.) :
        // on retente une fois en silence avant d'afficher une erreur visible.
        if (tentative < 2) {
          setTimeout(function () { chargerDonnees(tentative + 1); }, 1500);
          return;
        }
        const message = langueCourante_() === "EN"
          ? "Loading failed — this can occasionally happen with this demo version (free-tier infrastructure, limited capacity). Please refresh the page to try again."
          : "Le chargement a échoué — cela arrive parfois avec cette version de démonstration (infrastructure gratuite, capacité limitée). Rafraîchissez la page pour réessayer.";
        grille.innerHTML = '<p class="card-grid__etat">' + message + '</p>';
      });
  }

  /**
   * Affiche le lot de cartes suivant (12 de plus), sans redessiner celles
   * déjà affichées — évite un clignotement visuel au clic sur "Afficher plus".
   */
  function afficherLotSuivant() {
    if (nombreCartesVisibles === 0) {
      grille.innerHTML = ""; // on retire le message "Chargement…"
    }

    if (ressourcesAffichees.length === 0) {
      grille.innerHTML = '<p class="card-grid__etat" data-fr="Aucune ressource ne correspond à ces critères." ' +
        'data-en="No resource matches these criteria.">Aucune ressource ne correspond à ces critères.</p>';
      boutonAfficherPlus.hidden = true;
      compteurResultats.textContent = "0";
      return;
    }

    const prochainLot = ressourcesAffichees.slice(nombreCartesVisibles, nombreCartesVisibles + TAILLE_PAGE);
    prochainLot.forEach(function (ressource) {
      grille.appendChild(construireCarteRessource_(ressource));
    });

    nombreCartesVisibles += prochainLot.length;
    compteurResultats.textContent = String(ressourcesAffichees.length);
    boutonAfficherPlus.hidden = nombreCartesVisibles >= ressourcesAffichees.length;

    // Applique immédiatement la langue courante aux nouvelles cartes
    // (titres/labels bilingues des nouveaux éléments injectés).
    appliquerLangueSurElement_(grille);
  }

  boutonAfficherPlus.addEventListener("click", afficherLotSuivant);

  /**
   * Découpe une valeur "colonne multi-valeurs" (séparée par des virgules
   * dans le Google Sheet) en tableau de chaînes propres.
   */
  function decouperListe_(valeur) {
    return String(valeur || "")
      .split(",")
      .map(function (item) { return item.trim(); })
      .filter(Boolean);
  }

  /**
   * Détermine la classe CSS de couleur (Annexe 2) à partir d'un intitulé
   * de niveau tel que "S3 SCI", "S6 bio 4", "S7 bio 4" ou "STS".
   */
  function classeNiveau_(niveau) {
    const texte = String(niveau || "").trim().toLowerCase();
    if (texte === "sts") return "bg-niveau-sts";
    const correspondance = texte.match(/^s([1-7])\b/);
    return correspondance ? "bg-niveau-s" + correspondance[1] : "bg-niveau-all";
  }

  /**
   * Retrouve la ligne du référentiel "structure" correspondant à un thème
   * donné. Les noms de thème sont uniques dans tout le référentiel (confirmé
   * par l'utilisatrice) : une simple correspondance par nom suffit, pas besoin
   * de croiser avec le niveau de la ressource.
   */
  function trouverLigneStructure_(theme) {
    const themeCible = theme.trim().toLowerCase();
    return referentielStructure.find(function (ligne) {
      return String(ligne.theme).trim().toLowerCase() === themeCible;
    });
  }

  /**
   * Construit l'élément DOM d'une carte-ressource à partir d'une ligne
   * de données brute renvoyée par le backend.
   */
  function construireCarteRessource_(ressource) {
    const themes = decouperListe_(ressource.theme);

    const carte = document.createElement("article");
    carte.className = "card";

    // --- Image (avec repli automatique sur l'image par défaut) ---
    const imageWrap = document.createElement("div");
    imageWrap.className = "card__image-wrap";
    const image = document.createElement("img");
    image.className = "card__image";
    image.loading = "lazy";
    image.alt = "";
    image.src = ressource.image || "default-image.jpg";
    image.onerror = function () {
      image.onerror = null;
      image.src = "default-image.jpg";
    };
    imageWrap.appendChild(image);
    carte.appendChild(imageWrap);

    // --- Corps de la carte ---
    const corps = document.createElement("div");
    corps.className = "card__body";

    const titre = document.createElement("h2");
    titre.className = "card__title";
    titre.textContent = ressource.titre || "";
    corps.appendChild(titre);

    // --- Badges ---
    const badges = document.createElement("div");
    badges.className = "card__badges";

    // Badge 1 : un par thème, icône seule, couleur = niveau associé (CDC)
    themes.forEach(function (theme) {
      const ligneStructure = trouverLigneStructure_(theme);
      if (!ligneStructure) {
        console.warn('Aucune ligne "structure" ne correspond exactement au thème : "' + theme + '" (ressource : "' + ressource.titre + '")');
      } else if (!ligneStructure.icone) {
        console.warn('Le thème "' + theme + '" existe dans "structure" mais sa colonne icone est vide.');
      }
      const icone = ligneStructure ? ligneStructure.icone : "default-icon";
      const classeCouleur = ligneStructure ? classeNiveau_(ligneStructure.niveau) : "bg-niveau-all";

      const badge = document.createElement("span");
      badge.className = "badge badge--niveau " + classeCouleur;
      badge.title = ligneStructure ? (ligneStructure.niveau + " - " + theme) : theme;
      badge.innerHTML = '<svg class="badge-icone" width="16" height="16" aria-hidden="true">' +
        '<use href="#' + icone + '"></use></svg>';
      badges.appendChild(badge);
    });

    // Badge 2 : type(s) de document (texte selon la langue active) — une
    // ressource peut avoir plusieurs types (ex : texte ET dessin humoristique).
    const typesFr = decouperListe_(ressource.type_fr);
    const typesEn = decouperListe_(ressource.type_en);
    typesFr.forEach(function (typeFr, index) {
      const typeEn = typesEn[index] || typeFr;
      const badgeType = document.createElement("span");
      badgeType.className = "badge badge--type";
      badgeType.setAttribute("data-fr", typeFr);
      badgeType.setAttribute("data-en", typeEn);
      badgeType.textContent = htmlEl.getAttribute("data-lang") === "EN" ? typeEn : typeFr;
      badges.appendChild(badgeType);
    });

    // Badge 3 : langue(s) (abréviation brute, ex: FR, EN, NL) — une ressource
    // peut être bilingue.
    decouperListe_(ressource.langue).forEach(function (langue) {
      const badgeLangue = document.createElement("span");
      badgeLangue.className = "badge badge--langue";
      badgeLangue.textContent = langue;
      badges.appendChild(badgeLangue);
    });

    corps.appendChild(badges);

    // --- Métadonnées (proposé par — établissement) ---
    const meta = document.createElement("p");
    meta.className = "card__meta";
    meta.textContent = [ressource.propose_par, ressource.etablissement].filter(Boolean).join(" — ");
    corps.appendChild(meta);

    // --- Bouton "Signaler un problème" (délégation déjà branchée au §2) ---
    const boutonSignaler = document.createElement("button");
    boutonSignaler.type = "button";
    boutonSignaler.className = "card__report-btn btn-open-report";
    boutonSignaler.setAttribute("data-fr", "Signaler un problème");
    boutonSignaler.setAttribute("data-en", "Report a problem");
    boutonSignaler.textContent = htmlEl.getAttribute("data-lang") === "EN" ? "Report a problem" : "Signaler un problème";
    corps.appendChild(boutonSignaler);

    // Lien cliquable vers la ressource elle-même (sur l'image et le titre)
    if (ressource.url) {
      imageWrap.style.cursor = "pointer";
      titre.style.cursor = "pointer";
      const ouvrirRessource = function () { window.open(ressource.url, "_blank", "noopener"); };
      imageWrap.addEventListener("click", ouvrirRessource);
      titre.addEventListener("click", ouvrirRessource);
    }

    carte.appendChild(corps);
    return carte;
  }

  /**
   * Ré-applique la traduction FR/EN sur un sous-arbre du DOM (utilisé après
   * l'injection de nouvelles cartes, qui portent aussi des attributs
   * data-fr/data-en pour le badge type et le bouton signaler).
   */
  function appliquerLangueSurElement_(racine) {
    const lang = htmlEl.getAttribute("data-lang") === "EN" ? "EN" : "FR";
    racine.querySelectorAll("[data-fr][data-en]").forEach(function (el) {
      el.textContent = lang === "EN" ? el.dataset.en : el.dataset.fr;
    });
  }

  /* =======================================================
     6. LES 8 FILTRES — facettes dynamiques généralisées
     ======================================================= */
  const elFiltreRecherche = document.getElementById("filter-search");
  const elFiltreNiveau = document.getElementById("filter-niveau");
  const elFiltreTheme = document.getElementById("filter-theme");
  const elFiltreType = document.getElementById("filter-type");
  const elFiltreLangue = document.getElementById("filter-langue");
  const elFiltreProposePar = document.getElementById("filter-propose-par");
  const elFiltreEtablissement = document.getElementById("filter-etablissement");
  const elFiltreMotsCles = document.getElementById("filter-keywords");
  const boutonReset = document.getElementById("btn-reset-filters");

  function langueCourante_() {
    return htmlEl.getAttribute("data-lang") === "EN" ? "EN" : "FR";
  }

  /**
   * Détermine si une ressource correspond à l'état actuel des filtres.
   * @param {string|null} facetteIgnoree - nom du filtre à ignorer dans ce
   *   calcul ("niveau", "themes", "type", "langues", "proposePar",
   *   "etablissement", "motsCles"), ou null pour appliquer les 8 filtres.
   *   Utilisé pour les facettes dynamiques : chaque filtre calcule ses
   *   propres options disponibles en ignorant SA propre sélection, mais en
   *   tenant compte de tous les autres filtres actifs.
   */
  function correspondAuxFiltres_(r, facetteIgnoree) {
    if (filtres.recherche) {
      const texte = [r.titre, r.theme, r.topic, r.mots_cles, r.keywords, r.type_fr, r.type_en]
        .join(" ").toLowerCase();
      if (texte.indexOf(filtres.recherche.toLowerCase()) === -1) return false;
    }

    if (facetteIgnoree !== "niveau" && filtres.niveau &&
        decouperListe_(r.niveau).indexOf(filtres.niveau) === -1) return false;

    // Thème : logique ET — la ressource doit avoir TOUS les thèmes cochés
    // (transversalité pédagogique, cf. décision actée avec l'utilisatrice).
    if (facetteIgnoree !== "themes" && filtres.themes.size > 0) {
      const themesRessource = decouperListe_(r.theme);
      const tousPresents = Array.from(filtres.themes).every(function (t) { return themesRessource.indexOf(t) !== -1; });
      if (!tousPresents) return false;
    }

    if (facetteIgnoree !== "type" && filtres.type &&
        decouperListe_(r.type_fr).indexOf(filtres.type) === -1) return false;

    // Langue : logique OU — FR ou EN affiche les deux (CDC confirmé).
    if (facetteIgnoree !== "langues" && filtres.langues.size > 0) {
      const languesRessource = decouperListe_(r.langue);
      const auMoinsUne = Array.from(filtres.langues).some(function (l) { return languesRessource.indexOf(l) !== -1; });
      if (!auMoinsUne) return false;
    }

    if (facetteIgnoree !== "proposePar" && filtres.proposePar &&
        String(r.propose_par || "").trim() !== filtres.proposePar) return false;

    if (facetteIgnoree !== "etablissement" && filtres.etablissement &&
        String(r.etablissement || "").trim() !== filtres.etablissement) return false;

    // Mots-clés : logique OU (CDC confirmé).
    if (facetteIgnoree !== "motsCles" && filtres.motsCles.size > 0) {
      const champ = langueCourante_() === "EN" ? "keywords" : "mots_cles";
      const motsRessource = decouperListe_(r[champ]);
      const auMoinsUn = Array.from(filtres.motsCles).some(function (m) { return motsRessource.indexOf(m) !== -1; });
      if (!auMoinsUn) return false;
    }

    return true;
  }

  /**
   * Ressources compatibles avec tous les filtres actifs SAUF la facette
   * indiquée — c'est la base de calcul de chaque liste d'options.
   */
  function calculerCandidatsPourFacette_(facetteIgnoree) {
    return toutesLesRessources.filter(function (r) { return correspondAuxFiltres_(r, facetteIgnoree); });
  }

  /**
   * Construit un <label><input type="checkbox">libellé</label>, utilisé
   * pour les filtres langue et mots-clés.
   */
  function construireCaseACocher_(valeur, libelle, onChange) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = valeur;
    input.addEventListener("change", function () { onChange(input.checked); });
    label.appendChild(input);
    label.appendChild(document.createTextNode(" " + libelle));
    return label;
  }

  // --- 2. Niveau : liste déroulante, uniquement les niveaux compatibles ---
  function actualiserOptionsNiveau_() {
    const candidats = calculerCandidatsPourFacette_("niveau");
    const disponibles = [];
    candidats.forEach(function (r) {
      decouperListe_(r.niveau).forEach(function (n) { if (disponibles.indexOf(n) === -1) disponibles.push(n); });
    });

    if (filtres.niveau && disponibles.indexOf(filtres.niveau) === -1) filtres.niveau = "";

    // Ordre d'apparition dans le référentiel, filtré aux valeurs disponibles.
    const ordre = [];
    referentielStructure.forEach(function (l) {
      const n = String(l.niveau || "").trim();
      if (disponibles.indexOf(n) !== -1 && ordre.indexOf(n) === -1) ordre.push(n);
    });

    elFiltreNiveau.innerHTML = '<option value="" data-fr="Tous les niveaux" data-en="All levels">Tous les niveaux</option>';
    ordre.forEach(function (n) {
      const option = document.createElement("option");
      option.value = n;
      option.textContent = n;
      option.style.backgroundColor = couleurDeNiveau_(n);
      option.style.color = "#1e293b";
      elFiltreNiveau.appendChild(option);
    });
    elFiltreNiveau.value = filtres.niveau;
    elFiltreNiveau.style.backgroundColor = filtres.niveau ? couleurDeNiveau_(filtres.niveau) : "";
    elFiltreNiveau.style.color = filtres.niveau ? "#1e293b" : "";
  }

  /**
   * Lit la couleur de fond réelle (Annexe 2) associée à un niveau, via la
   * variable CSS correspondante — évite de dupliquer la palette en JS.
   * NOTE : le style des <option> d'un <select> natif n'est pas garanti sur
   * tous les navigateurs (Safari macOS/iOS l'ignore souvent) ; c'est une
   * limitation de la plateforme, pas un bug de cette fonction.
   */
  function couleurDeNiveau_(niveau) {
    const nomVariable = "--" + classeNiveau_(niveau);
    return getComputedStyle(document.documentElement).getPropertyValue(nomVariable).trim();
  }

  // --- 3. Thème : étiquettes, uniquement les thèmes compatibles ---
  function actualiserOptionsTheme_() {
    const candidats = calculerCandidatsPourFacette_("themes");
    const disponibles = [];
    candidats.forEach(function (r) {
      decouperListe_(r.theme).forEach(function (t) { if (disponibles.indexOf(t) === -1) disponibles.push(t); });
    });

    Array.from(filtres.themes).forEach(function (t) {
      if (disponibles.indexOf(t) === -1) filtres.themes.delete(t);
    });

    elFiltreTheme.innerHTML = "";
    referentielStructure.forEach(function (ligne) {
      if (disponibles.indexOf(ligne.theme) === -1) return;

      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip " + classeNiveau_(ligne.niveau);
      chip.setAttribute("aria-pressed", filtres.themes.has(ligne.theme) ? "true" : "false");
      chip.dataset.theme = ligne.theme;

      const icone = ligne.icone || "default-icon";
      chip.innerHTML =
        '<svg width="14" height="14" aria-hidden="true"><use href="#' + icone + '"></use></svg>' +
        '<span data-fr="' + ligne.theme + '" data-en="' + (ligne.topic || ligne.theme) + '">' +
        (langueCourante_() === "EN" ? (ligne.topic || ligne.theme) : ligne.theme) + '</span>';

      chip.addEventListener("click", function () {
        const actif = chip.getAttribute("aria-pressed") === "true";
        chip.setAttribute("aria-pressed", String(!actif));
        if (actif) filtres.themes.delete(ligne.theme);
        else filtres.themes.add(ligne.theme);
        surChangementFiltre_();
      });

      elFiltreTheme.appendChild(chip);
    });
  }

  // --- 4. Type de contenu : liste déroulante, uniquement les types compatibles ---
  function actualiserOptionsType_() {
    const candidats = calculerCandidatsPourFacette_("type");
    const disponibles = [];
    candidats.forEach(function (r) {
      decouperListe_(r.type_fr).forEach(function (t) { if (disponibles.indexOf(t) === -1) disponibles.push(t); });
    });

    if (filtres.type && disponibles.indexOf(filtres.type) === -1) filtres.type = "";

    elFiltreType.innerHTML = '<option value="" data-fr="Tous les types" data-en="All types">Tous les types</option>';
    referentielTypes.forEach(function (ligne) {
      if (disponibles.indexOf(ligne.FR) === -1) return;
      const option = document.createElement("option");
      option.value = ligne.FR;
      option.setAttribute("data-fr", ligne.FR);
      option.setAttribute("data-en", ligne.EN);
      option.textContent = langueCourante_() === "EN" ? ligne.EN : ligne.FR;
      elFiltreType.appendChild(option);
    });
    elFiltreType.value = filtres.type;
  }

  // --- 5. Langue : cases à cocher, uniquement les langues compatibles ---
  function actualiserOptionsLangue_() {
    const candidats = calculerCandidatsPourFacette_("langues");
    const disponibles = [];
    candidats.forEach(function (r) {
      decouperListe_(r.langue).forEach(function (l) { if (disponibles.indexOf(l) === -1) disponibles.push(l); });
    });

    Array.from(filtres.langues).forEach(function (l) {
      if (disponibles.indexOf(l) === -1) filtres.langues.delete(l);
    });

    elFiltreLangue.innerHTML = "";
    referentielLangues.forEach(function (ligne) {
      const abrev = ligne.abreviation_langue;
      if (disponibles.indexOf(abrev) === -1) return;
      const caseACocher = construireCaseACocher_(abrev, abrev, function (coche) {
        if (coche) filtres.langues.add(abrev); else filtres.langues.delete(abrev);
        surChangementFiltre_();
      });
      caseACocher.querySelector("input").checked = filtres.langues.has(abrev);
      elFiltreLangue.appendChild(caseACocher);
    });
  }

  /**
   * Remplit un <select> à partir d'une liste de ressources déjà filtrées
   * (candidats), pour les colonnes sans référentiel dédié (propose_par,
   * etablissement).
   */
  function remplirSelectDepuisListe_(select, candidats, cle, labelFr, labelEn, cleFiltre) {
    const valeurs = [];
    candidats.forEach(function (r) {
      const v = String(r[cle] || "").trim();
      if (v && valeurs.indexOf(v) === -1) valeurs.push(v);
    });
    valeurs.sort(function (a, b) { return a.localeCompare(b, "fr"); });

    if (filtres[cleFiltre] && valeurs.indexOf(filtres[cleFiltre]) === -1) filtres[cleFiltre] = "";

    select.innerHTML = "";
    const optionTous = document.createElement("option");
    optionTous.value = "";
    optionTous.setAttribute("data-fr", labelFr);
    optionTous.setAttribute("data-en", labelEn);
    optionTous.textContent = langueCourante_() === "EN" ? labelEn : labelFr;
    select.appendChild(optionTous);

    valeurs.forEach(function (v) {
      const option = document.createElement("option");
      option.value = v;
      option.textContent = v;
      select.appendChild(option);
    });
    select.value = filtres[cleFiltre] || "";
  }

  // --- 6. Proposé par / 7. Établissement : listes déroulantes réactives ---
  function actualiserOptionsProposePar_() {
    remplirSelectDepuisListe_(elFiltreProposePar, calculerCandidatsPourFacette_("proposePar"),
      "propose_par", "Tous les contributeurs", "All contributors", "proposePar");
  }
  function actualiserOptionsEtablissement_() {
    remplirSelectDepuisListe_(elFiltreEtablissement, calculerCandidatsPourFacette_("etablissement"),
      "etablissement", "Tous les établissements", "All schools", "etablissement");
  }

  // --- 8. Mots-clés : boîte réductrice, uniquement les mots compatibles ---
  function actualiserOptionsMotsCles_() {
    const champ = langueCourante_() === "EN" ? "keywords" : "mots_cles";
    const candidats = calculerCandidatsPourFacette_("motsCles");

    const motsDisponibles = [];
    candidats.forEach(function (r) {
      decouperListe_(r[champ]).forEach(function (mot) {
        if (motsDisponibles.indexOf(mot) === -1) motsDisponibles.push(mot);
      });
    });
    motsDisponibles.sort(function (a, b) { return a.localeCompare(b, langueCourante_() === "EN" ? "en" : "fr"); });

    Array.from(filtres.motsCles).forEach(function (mot) {
      if (motsDisponibles.indexOf(mot) === -1) filtres.motsCles.delete(mot);
    });

    elFiltreMotsCles.innerHTML = "";
    if (motsDisponibles.length === 0) {
      const vide = document.createElement("p");
      vide.style.margin = "0";
      vide.style.color = "var(--color-text-muted)";
      vide.setAttribute("data-fr", "Aucun mot-clé disponible avec ces filtres.");
      vide.setAttribute("data-en", "No keyword available with these filters.");
      vide.textContent = langueCourante_() === "EN" ? "No keyword available with these filters." : "Aucun mot-clé disponible avec ces filtres.";
      elFiltreMotsCles.appendChild(vide);
      return;
    }

    motsDisponibles.forEach(function (mot) {
      const caseACocher = construireCaseACocher_(mot, mot, function (coche) {
        if (coche) filtres.motsCles.add(mot); else filtres.motsCles.delete(mot);
        surChangementFiltre_();
      });
      caseACocher.querySelector("input").checked = filtres.motsCles.has(mot);
      elFiltreMotsCles.appendChild(caseACocher);
    });
  }

  /**
   * Reconstruit les 8 filtres, chacun ne proposant que les options
   * compatibles avec l'état actuel des 7 autres — facettes dynamiques
   * généralisées à l'ensemble des filtres (décision actée avec l'utilisatrice).
   */
  function rafraichirToutesLesFacettes_() {
    actualiserOptionsNiveau_();
    actualiserOptionsTheme_();
    actualiserOptionsType_();
    actualiserOptionsLangue_();
    actualiserOptionsProposePar_();
    actualiserOptionsEtablissement_();
    actualiserOptionsMotsCles_();
  }

  /**
   * Applique l'ensemble des filtres, réaffiche la grille depuis le début,
   * et met à jour l'URL.
   */
  function appliquerFiltres_() {
    ressourcesAffichees = toutesLesRessources.filter(function (r) { return correspondAuxFiltres_(r, null); });
    nombreCartesVisibles = 0;
    afficherLotSuivant();
    actualiserUrlFiltres_();
  }

  /**
   * À appeler à chaque changement de n'importe quel filtre : reconstruit
   * toutes les facettes (chacune peut désormais dépendre de toutes les
   * autres), puis applique le résultat à la grille.
   */
  function surChangementFiltre_() {
    rafraichirToutesLesFacettes_();
    appliquerFiltres_();
  }

  /**
   * Persiste l'état des filtres dans l'URL (history.replaceState), pour
   * qu'un lien partagé restaure la même vue.
   */
  function actualiserUrlFiltres_() {
    const params = new URLSearchParams(window.location.search);
    const definir = function (cle, valeur) {
      if (valeur) params.set(cle, valeur); else params.delete(cle);
    };
    definir("q", filtres.recherche);
    definir("niveau", filtres.niveau);
    definir("theme", Array.from(filtres.themes).join(","));
    definir("type", filtres.type);
    definir("langue", Array.from(filtres.langues).join(","));
    definir("par", filtres.proposePar);
    definir("etablissement", filtres.etablissement);
    definir("motscles", Array.from(filtres.motsCles).join(","));
    history.replaceState(null, "", "?" + params.toString());
  }

  /**
   * Restaure l'état des filtres depuis les paramètres d'URL au premier
   * chargement. Ne touche pas au DOM directement : rafraichirToutesLesFacettes_
   * (appelé juste après) reflète cet état sur chaque contrôle.
   */
  function restaurerFiltresDepuisUrl_() {
    const params = new URLSearchParams(window.location.search);

    filtres.recherche = params.get("q") || "";
    elFiltreRecherche.value = filtres.recherche;

    filtres.niveau = params.get("niveau") || "";
    (params.get("theme") || "").split(",").filter(Boolean).forEach(function (t) { filtres.themes.add(t); });
    filtres.type = params.get("type") || "";
    (params.get("langue") || "").split(",").filter(Boolean).forEach(function (l) { filtres.langues.add(l); });
    filtres.proposePar = params.get("par") || "";
    filtres.etablissement = params.get("etablissement") || "";
    (params.get("motscles") || "").split(",").filter(Boolean).forEach(function (m) { filtres.motsCles.add(m); });
  }

  // --- Écouteurs des filtres simples (texte + menus déroulants) ---
  elFiltreRecherche.addEventListener("input", function () {
    filtres.recherche = elFiltreRecherche.value.trim();
    surChangementFiltre_();
  });
  elFiltreNiveau.addEventListener("change", function () {
    filtres.niveau = elFiltreNiveau.value;
    surChangementFiltre_();
  });
  elFiltreType.addEventListener("change", function () {
    filtres.type = elFiltreType.value;
    surChangementFiltre_();
  });
  elFiltreProposePar.addEventListener("change", function () {
    filtres.proposePar = elFiltreProposePar.value;
    surChangementFiltre_();
  });
  elFiltreEtablissement.addEventListener("change", function () {
    filtres.etablissement = elFiltreEtablissement.value;
    surChangementFiltre_();
  });

  boutonReset.addEventListener("click", function () {
    filtres.recherche = "";
    filtres.niveau = "";
    filtres.themes.clear();
    filtres.type = "";
    filtres.langues.clear();
    filtres.proposePar = "";
    filtres.etablissement = "";
    filtres.motsCles.clear();
    elFiltreRecherche.value = "";
    rafraichirToutesLesFacettes_();
    appliquerFiltres_();
  });

  /* =======================================================
     7. MODALE "PROPOSER UNE RESSOURCE" (IA + manuel)
     ======================================================= */

  // ATTENTION : à remplacer par la vraie valeur de la propriété de script
  // "API_SECRET_TOKEN" côté Apps Script. Visible dans le code source client
  // (limite structurelle déjà actée dans "Limites acceptées").
  const TOKEN_FRONTEND = "Banque123Ressource456";
  const ORIGIN_DECLARE = window.location.origin;

  const gabaritFormulaire = document.getElementById("gabarit-formulaire-ressource");
  const formIA = document.getElementById("form-ia");
  const formManuel = document.getElementById("form-manuel");

  /**
   * Construit un formulaire (IA ou manuel) à partir du gabarit <template>,
   * peuple ses listes de niveau/thème/type/langue depuis les référentiels,
   * et branche la saisie de mots-clés + l'option "Autre" + la soumission.
   */
  function construireFormulaire_(form) {
    form.innerHTML = "";
    form.appendChild(gabaritFormulaire.content.cloneNode(true));
    form.__motsCles = [];
    form.__keywords = [];

    // Thème, regroupé visuellement par niveau (un sous-bloc titré par niveau,
    // ses thèmes juste en dessous). Le niveau n'est plus une saisie directe :
    // il sera déduit des thèmes cochés au moment de la soumission
    // (lireFormulaire_), ce qui rend une incohérence niveau/thème
    // structurellement impossible plutôt que de la détecter après coup.
    const conteneurTheme = form.querySelector('[data-role="theme"]');
    const niveauxUniques = [];
    referentielStructure.forEach(function (l) {
      const n = String(l.niveau || "").trim();
      if (n && niveauxUniques.indexOf(n) === -1) niveauxUniques.push(n);
    });

    niveauxUniques.forEach(function (niveau) {
      const groupe = document.createElement("div");
      groupe.className = "niveau-groupe";

      const titre = document.createElement("p");
      titre.className = "niveau-groupe__titre";
      titre.textContent = niveau;
      groupe.appendChild(titre);

      const listeChips = document.createElement("div");
      listeChips.className = "chip-list";

      referentielStructure
        .filter(function (ligne) { return String(ligne.niveau || "").trim() === niveau; })
        .forEach(function (ligne) {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "chip " + classeNiveau_(ligne.niveau);
          chip.setAttribute("aria-pressed", "false");
          chip.dataset.theme = ligne.theme;
          const icone = ligne.icone || "default-icon";
          chip.innerHTML =
            '<svg width="14" height="14" aria-hidden="true"><use href="#' + icone + '"></use></svg>' +
            '<span data-fr="' + ligne.theme + '" data-en="' + (ligne.topic || ligne.theme) + '">' +
            (langueCourante_() === "EN" ? (ligne.topic || ligne.theme) : ligne.theme) + '</span>';
          chip.addEventListener("click", function () {
            chip.setAttribute("aria-pressed", chip.getAttribute("aria-pressed") === "true" ? "false" : "true");
          });
          listeChips.appendChild(chip);
        });

      groupe.appendChild(listeChips);
      conteneurTheme.appendChild(groupe);
    });

    // Type de contenu (cases à cocher) + option "Autre"
    const conteneurType = form.querySelector('[data-role="type"]');
    referentielTypes.forEach(function (ligne) {
      const caseType = construireCaseACocher_(ligne.FR, langueCourante_() === "EN" ? ligne.EN : ligne.FR, function () {});
      caseType.querySelector("input").dataset.typeEn = ligne.EN;
      conteneurType.appendChild(caseType);
    });
    const toggleAutre = form.querySelector('[data-role="type-autre-active"]');
    const champsAutre = form.querySelector('[data-role="type-autre-champs"]');
    toggleAutre.addEventListener("change", function () {
      champsAutre.hidden = !toggleAutre.checked;
    });

    // Langue (cases à cocher)
    const conteneurLangue = form.querySelector('[data-role="langue"]');
    referentielLangues.forEach(function (ligne) {
      const abrev = ligne.abreviation_langue;
      conteneurLangue.appendChild(construireCaseACocher_(abrev, abrev, function () {}));
    });

    // Mots-clés / keywords : étiquettes + champ d'ajout
    brancherTagInput_(form, "mots-cles", "__motsCles");
    brancherTagInput_(form, "keywords", "__keywords");

    // Soumission
    form.addEventListener("submit", function (evenement) {
      evenement.preventDefault();
      soumettreFormulaire_(form);
    });
  }

  /**
   * Branche un champ de saisie de mots-clés sous forme d'étiquettes
   * (ajout par Entrée ou virgule, suppression par le bouton "×" de
   * chaque étiquette). L'état vit dans form[proprieteEtat] (un tableau).
   */
  function brancherTagInput_(form, role, proprieteEtat) {
    const conteneurTags = form.querySelector('[data-role="' + role + '-tags"]');
    const champAjout = form.querySelector('[data-role="' + role + '-ajout"]');

    function reafficher() {
      conteneurTags.innerHTML = "";
      form[proprieteEtat].forEach(function (valeur, index) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.appendChild(document.createTextNode(valeur));

        const boutonSupprimer = document.createElement("button");
        boutonSupprimer.type = "button";
        boutonSupprimer.className = "tag__supprimer";
        boutonSupprimer.setAttribute("aria-label", "Supprimer");
        boutonSupprimer.textContent = "×";
        boutonSupprimer.addEventListener("click", function () {
          form[proprieteEtat].splice(index, 1);
          reafficher();
        });

        tag.appendChild(boutonSupprimer);
        conteneurTags.appendChild(tag);
      });
    }

    champAjout.addEventListener("keydown", function (evenement) {
      if (evenement.key === "Enter" || evenement.key === ",") {
        evenement.preventDefault();
        const valeur = champAjout.value.trim().replace(/,$/, "");
        if (valeur && form[proprieteEtat].indexOf(valeur) === -1) {
          form[proprieteEtat].push(valeur);
          reafficher();
        }
        champAjout.value = "";
      }
    });

    form["__reafficher_" + role] = reafficher;
    reafficher();
  }

  /**
   * Coche, dans un groupe de cases à cocher du formulaire, celles dont la
   * valeur figure dans le tableau fourni — sauf si "reconnu" est false,
   * auquel cas on laisse tout décoché et on affiche le message d'alerte
   * (décision actée : même traitement pour niveau/thème/type/langue).
   */
  function cocherSiReconnu_(form, role, valeurs, reconnu) {
    const alerte = form.querySelector('[data-role="' + role + '-alerte"]');
    alerte.hidden = reconnu !== false;
    if (reconnu === false) return;

    form.querySelectorAll('[data-role="' + role + '"] input[type="checkbox"]').forEach(function (input) {
      input.checked = (valeurs || []).indexOf(input.value) !== -1;
    });
  }

  /** Variante pour le thème, qui utilise des étiquettes (aria-pressed) et non des cases à cocher. */
  function cocherThemesSiReconnu_(form, valeurs, reconnu) {
    const alerte = form.querySelector('[data-role="theme-alerte"]');
    alerte.hidden = reconnu !== false;
    if (reconnu === false) return;

    form.querySelectorAll('[data-role="theme"] .chip').forEach(function (chip) {
      chip.setAttribute("aria-pressed", (valeurs || []).indexOf(chip.dataset.theme) !== -1 ? "true" : "false");
    });
  }

  /**
   * Pré-remplit le formulaire IA à partir de la réponse de analyzeUrl.
   * Si la ressource a été jugée non pertinente et que l'utilisateur choisit
   * de continuer malgré tout, la classification (niveau/thème/type/langue)
   * n'est délibérément PAS pré-remplie, même si l'IA en a proposé une —
   * elle n'est pas fiable dans ce cas de figure.
   */
  function preRemplirFormulaireIA_(resultat, urlAnalysee, classificationFiable) {
    formIA.querySelector('[data-role="url"]').value = urlAnalysee;
    formIA.querySelector('[data-role="titre"]').value = resultat.titre || "";
    formIA.querySelector('[data-role="image"]').value = resultat.image || "";

    if (classificationFiable) {
      cocherThemesSiReconnu_(formIA, resultat.theme, resultat.theme_reconnu);
      cocherSiReconnu_(formIA, "type", resultat.type_fr, resultat.type_reconnu);
      cocherSiReconnu_(formIA, "langue", resultat.langue, resultat.langue_reconnue);
      formIA.__motsCles = (resultat.mots_cles || []).slice();
      formIA.__keywords = (resultat.keywords || []).slice();
    } else {
      cocherThemesSiReconnu_(formIA, [], false);
      cocherSiReconnu_(formIA, "type", [], false);
      cocherSiReconnu_(formIA, "langue", [], false);
      formIA.__motsCles = [];
      formIA.__keywords = [];
    }
    formIA["__reafficher_mots-cles"]();
    formIA["__reafficher_keywords"]();
  }

  /**
   * Lit l'état complet d'un formulaire (IA ou manuel) pour construire le
   * payload attendu par l'endpoint d'écriture.
   */
  function lireFormulaire_(form) {
    const lireChamp = function (role) {
      return form.querySelector('[data-role="' + role + '"]').value.trim();
    };
    const lireCoches = function (role) {
      return Array.from(form.querySelectorAll('[data-role="' + role + '"] input[type="checkbox"]:checked'))
        .map(function (input) { return input.value; });
    };
    const lireThemesCoches = function () {
      return Array.from(form.querySelectorAll('[data-role="theme"] .chip[aria-pressed="true"]'))
        .map(function (chip) { return chip.dataset.theme; });
    };

    const donnees = {
      url: lireChamp("url"),
      titre: lireChamp("titre"),
      image: lireChamp("image"),
      theme: lireThemesCoches(),
      type_fr: lireCoches("type"),
      type_en: Array.from(form.querySelectorAll('[data-role="type"] input[type="checkbox"]:checked'))
        .map(function (input) { return input.dataset.typeEn || ""; }),
      langue: lireCoches("langue"),
      mots_cles: form.__motsCles.slice(),
      keywords: form.__keywords.slice(),
      propose_par: lireChamp("propose-par"),
      etablissement: lireChamp("etablissement")
    };

    // "niveau" n'est jamais saisi directement : il est déduit des thèmes
    // cochés, via le référentiel structure (chaque thème n'appartient qu'à
    // un seul niveau), pour rendre une incohérence niveau/thème
    // structurellement impossible plutôt que de la détecter après coup.
    donnees.niveau = [];
    donnees.theme.forEach(function (theme) {
      const ligne = referentielStructure.find(function (l) {
        return normaliserAccentsClient_(l.theme) === normaliserAccentsClient_(theme);
      });
      if (ligne) {
        const niveauDeduit = String(ligne.niveau || "").trim();
        if (niveauDeduit && donnees.niveau.indexOf(niveauDeduit) === -1) donnees.niveau.push(niveauDeduit);
      }
    });

    // "topic" (traduction anglaise du thème) n'est jamais saisi directement :
    // il est déduit du référentiel structure, thème par thème, pour rester
    // toujours synchronisé avec "theme" (même ordre, même nombre).
    donnees.topic = donnees.theme.map(function (theme) {
      const ligne = referentielStructure.find(function (l) {
        return normaliserAccentsClient_(l.theme) === normaliserAccentsClient_(theme);
      });
      return ligne ? ligne.topic : "";
    });

    // Option "Autre" : ajoute un type supplémentaire hors référentiel.
    if (form.querySelector('[data-role="type-autre-active"]').checked) {
      const typeAutreFr = form.querySelector('[data-role="type-autre-fr"]').value.trim();
      if (typeAutreFr) {
        donnees.type_fr.push(typeAutreFr);
        donnees.type_en.push(form.querySelector('[data-role="type-autre-en"]').value.trim());
      }
    }

    return donnees;
  }

  /**
   * Envoie le formulaire au backend (POST no-cors). Comme la réponse n'est
   * jamais lisible en no-cors, l'UI affiche un succès dès l'envoi — c'est
   * un optimisme délibéré, déjà documenté dans les "Limites acceptées".
   */
  function soumettreFormulaire_(form) {
    const donnees = lireFormulaire_(form);
    const erreurEl = form.querySelector('[data-role="erreur-soumission"]');
    const succesEl = form.querySelector('[data-role="succes-soumission"]');
    erreurEl.hidden = true;
    succesEl.hidden = true;

    if (!donnees.url || !donnees.titre || !donnees.propose_par) {
      erreurEl.textContent = langueCourante_() === "EN"
        ? "Please fill in the URL, the title and your name."
        : "Merci de renseigner l'URL, le titre et votre nom.";
      erreurEl.hidden = false;
      return;
    }

    donnees.token = TOKEN_FRONTEND;
    donnees.origin = ORIGIN_DECLARE;

    fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(donnees)
    });

    closeModal(modalAddResource);
    openModal(document.getElementById("modal-confirmation-ajout"));
  }

  /** Remet un formulaire à zéro (après envoi, ou à l'ouverture de la modale). */
  function reinitialiserFormulaire_(form) {
    form.reset();
    form.__motsCles = [];
    form.__keywords = [];
    if (form["__reafficher_mots-cles"]) form["__reafficher_mots-cles"]();
    if (form["__reafficher_keywords"]) form["__reafficher_keywords"]();
    form.querySelectorAll(".chip").forEach(function (chip) { chip.setAttribute("aria-pressed", "false"); });
    form.querySelectorAll(".form-alerte").forEach(function (alerte) { alerte.hidden = true; });
    const toggleAutre = form.querySelector('[data-role="type-autre-active"]');
    if (toggleAutre) toggleAutre.checked = false;
    const champsAutre = form.querySelector('[data-role="type-autre-champs"]');
    if (champsAutre) champsAutre.hidden = true;
  }

  // --- Bouton "Analyser" (onglet IA) ---
  document.getElementById("btn-analyser").addEventListener("click", function () {
    const url = document.getElementById("ia-url-saisie").value.trim();
    const erreurEl = document.getElementById("ia-erreur");
    erreurEl.hidden = true;

    if (!url) {
      erreurEl.textContent = langueCourante_() === "EN" ? "Please enter a URL." : "Merci de saisir une URL.";
      erreurEl.hidden = false;
      return;
    }

    document.getElementById("ia-etape-url").hidden = true;
    document.getElementById("ia-chargement").hidden = false;

    lancerAnalyseUrl_(url, 1);
  });

  /**
   * Lance l'appel à analyzeUrl, avec un réessai automatique silencieux en
   * cas d'échec réseau/parsing (aléa ponctuel de livraison côté Apps
   * Script, même famille que celui déjà rencontré sur getData — l'exécution
   * côté serveur peut très bien avoir réussi malgré cet échec de livraison).
   * Les erreurs applicatives (token invalide, Gemini indisponible...) ne
   * sont PAS réessayées ici : ce sont déjà de vraies réponses JSON, donc pas
   * concernées par ce problème de livraison.
   */
  function lancerAnalyseUrl_(url, tentative) {
    const erreurEl = document.getElementById("ia-erreur");

    const params = new URLSearchParams({
      action: "analyzeUrl",
      token: TOKEN_FRONTEND,
      origin: ORIGIN_DECLARE,
      url: url
    });

    fetch(APPS_SCRIPT_URL + "?" + params.toString())
      .then(function (reponse) { return reponse.json(); })
      .then(function (resultat) {
        document.getElementById("ia-chargement").hidden = true;

        if (resultat.erreur) {
          document.getElementById("ia-etape-url").hidden = false;
          erreurEl.textContent = resultat.erreur;
          erreurEl.hidden = false;
          return;
        }

        if (!resultat.est_pertinent) {
          document.getElementById("ia-rejet").hidden = false;
          document.getElementById("ia-rejet-message").textContent =
            langueCourante_() === "EN" ? resultat.motif_rejet_en : resultat.motif_rejet_fr;
          document.getElementById("btn-continuer-malgre-tout").onclick = function () {
            document.getElementById("ia-rejet").hidden = true;
            formIA.hidden = false;
            preRemplirFormulaireIA_(resultat, url, false);
          };
          return;
        }

        formIA.hidden = false;
        preRemplirFormulaireIA_(resultat, url, true);
      })
      .catch(function (erreur) {
        if (tentative < 2) {
          setTimeout(function () { lancerAnalyseUrl_(url, tentative + 1); }, 1500);
          return;
        }
        document.getElementById("ia-chargement").hidden = true;
        document.getElementById("ia-etape-url").hidden = false;
        erreurEl.textContent = (langueCourante_() === "EN" ? "Network error: " : "Erreur réseau : ") + erreur.message;
        erreurEl.hidden = false;
      });
  }

  /**
   * Normalise une chaîne pour comparaison robuste (accents, apostrophes,
   * casse) — équivalent client de normaliserAccents_ côté serveur.
   */
  function normaliserAccentsClient_(texte) {
    return String(texte || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/['\u2019\u02BC]/g, "'")
      .trim()
      .toLowerCase();
  }

  /**
   * Recalcule les indicateurs niveau_reconnu/theme_reconnu/type_reconnu/
   * langue_reconnue pour un résultat importé d'une IA externe, en comparant
   * chaque valeur au référentiel déjà chargé en mémoire — même logique que
   * la validation serveur de analyzeUrl, réécrite côté client puisque ce
   * résultat n'est jamais passé par notre backend. Convertit aussi la
   * langue (nom complet) en abréviation, et corrige la casse des types
   * reconnus vers leur orthographe canonique.
   */
  function validerImportExterne_(resultat) {
    const niveauxConnus = referentielStructure.map(function (l) { return normaliserAccentsClient_(l.niveau); });
    const niveauxProposes = Array.isArray(resultat.niveau) ? resultat.niveau : [];
    resultat.niveau_reconnu = niveauxProposes.length > 0 && niveauxProposes.every(function (n) {
      return niveauxConnus.indexOf(normaliserAccentsClient_(n)) !== -1;
    });

    const themesConnus = referentielStructure.map(function (l) { return normaliserAccentsClient_(l.theme); });
    const themesProposes = Array.isArray(resultat.theme) ? resultat.theme : [];
    resultat.theme_reconnu = themesProposes.length > 0 && themesProposes.every(function (t) {
      return themesConnus.indexOf(normaliserAccentsClient_(t)) !== -1;
    });

    const typesProposes = Array.isArray(resultat.type_fr) ? resultat.type_fr : [];
    const typeFrCorrige = [];
    let tousTypesReconnus = typesProposes.length > 0;
    typesProposes.forEach(function (t) {
      const cible = normaliserAccentsClient_(t);
      const trouve = referentielTypes.find(function (l) { return normaliserAccentsClient_(l.FR) === cible; });
      typeFrCorrige.push(trouve ? trouve.FR : t);
      if (!trouve) tousTypesReconnus = false;
    });
    resultat.type_fr = typeFrCorrige;
    resultat.type_reconnu = tousTypesReconnus;

    const languesProposees = Array.isArray(resultat.langue) ? resultat.langue : [];
    const abreviationsCorrigees = [];
    let toutesLanguesReconnues = languesProposees.length > 0;
    languesProposees.forEach(function (langue) {
      const cible = normaliserAccentsClient_(langue);
      const trouve = referentielLangues.find(function (l) { return normaliserAccentsClient_(l.langues) === cible; });
      abreviationsCorrigees.push(trouve ? trouve.abreviation_langue : langue);
      if (!trouve) toutesLanguesReconnues = false;
    });
    resultat.langue = abreviationsCorrigees;
    resultat.langue_reconnue = toutesLanguesReconnues;

    return resultat;
  }

  // --- Onglet "Import externe" ---

  document.getElementById("btn-generer-prompt").addEventListener("click", function () {
    const bouton = document.getElementById("btn-generer-prompt");
    const zone = document.getElementById("zone-prompt-genere");
    const zoneTexte = document.getElementById("texte-prompt-genere");
    const chargement = document.getElementById("prompt-chargement");

    bouton.disabled = true;
    chargement.hidden = false;
    const urlSaisie = document.getElementById("import-url").value.trim();
    const params = urlSaisie ? "&url=" + encodeURIComponent(urlSaisie) : "";
    fetch(APPS_SCRIPT_URL + "?action=genererPromptExterne" + params)
      .then(function (reponse) { return reponse.json(); })
      .then(function (resultat) {
        bouton.disabled = false;
        chargement.hidden = true;
        if (resultat.erreur) {
          zoneTexte.value = "";
          zone.hidden = true;
          return;
        }
        zoneTexte.value = resultat.prompt;
        zone.hidden = false;
      })
      .catch(function () {
        bouton.disabled = false;
        chargement.hidden = true;
      });
  });

  document.getElementById("btn-copier-prompt").addEventListener("click", function () {
    const zoneTexte = document.getElementById("texte-prompt-genere");
    const confirmation = document.getElementById("prompt-copie-confirmation");
    navigator.clipboard.writeText(zoneTexte.value).then(function () {
      confirmation.hidden = false;
      setTimeout(function () { confirmation.hidden = true; }, 3000);
    });
  });

  document.getElementById("btn-charger-import").addEventListener("click", function () {
    const url = document.getElementById("import-url").value.trim();
    const texteJson = document.getElementById("import-json-texte").value.trim();
    const erreurEl = document.getElementById("import-erreur");
    erreurEl.hidden = true;
    document.getElementById("import-succes").hidden = true;

    if (!url) {
      erreurEl.textContent = langueCourante_() === "EN" ? "Please enter a URL." : "Merci de saisir une URL.";
      erreurEl.hidden = false;
      return;
    }
    if (!texteJson) {
      erreurEl.textContent = langueCourante_() === "EN" ? "Please paste the JSON." : "Merci de coller le JSON.";
      erreurEl.hidden = false;
      return;
    }

    let resultat;
    try {
      resultat = JSON.parse(texteJson);
    } catch (erreurParsing) {
      erreurEl.textContent = langueCourante_() === "EN"
        ? "This text is not valid JSON. Copy exactly what the AI returned, nothing else."
        : "Ce texte n'est pas du JSON valide. Copiez exactement ce que l'IA a renvoyé, rien d'autre.";
      erreurEl.hidden = false;
      return;
    }

    // Un résultat externe n'a pas les indicateurs _reconnu (calculés côté
    // serveur pour analyzeUrl, absents du JSON produit par une IA tierce) :
    // on les recalcule nous-mêmes, ici, contre le référentiel déjà chargé.
    resultat = validerImportExterne_(resultat);

    if (resultat.est_pertinent === false) {
      erreurEl.textContent = langueCourante_() === "EN"
        ? "This AI judged the resource not relevant: " + (resultat.motif_rejet_en || "")
        : "Cette IA a jugé la ressource non pertinente : " + (resultat.motif_rejet_fr || "");
      erreurEl.hidden = false;
      // On affiche quand même le formulaire, au cas où l'enseignant ne soit pas d'accord.
    }

    formIA.hidden = false;
    preRemplirFormulaireIA_(resultat, url, true);

    if (resultat.est_pertinent !== false) {
      const succesEl = document.getElementById("import-succes");
      succesEl.hidden = false;
    }
    formIA.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /**
   * Remet la modale d'ajout à son état initial (étape URL de l'onglet IA,
   * formulaires vidés) à chaque ouverture — appelé depuis la section 2.
   */
  function reinitialiserModaleAjout_() {
    document.getElementById("ia-url-saisie").value = "";
    document.getElementById("ia-erreur").hidden = true;
    document.getElementById("ia-etape-url").hidden = false;
    document.getElementById("ia-chargement").hidden = true;
    document.getElementById("ia-rejet").hidden = true;

    document.getElementById("import-url").value = "";
    document.getElementById("import-json-texte").value = "";
    document.getElementById("import-erreur").hidden = true;
    document.getElementById("import-succes").hidden = true;
    document.getElementById("prompt-chargement").hidden = true;
    document.getElementById("zone-prompt-genere").hidden = true;
    document.getElementById("texte-prompt-genere").value = "";

    // Remet l'onglet actif sur "Analyse IA par URL" (premier onglet), pour
    // que "revenir à la version de départ" soit vrai aussi pour les onglets.
    document.querySelectorAll(".tab").forEach(function (tab) {
      const estIA = tab.dataset.tab === "ia";
      tab.classList.toggle("tab--active", estIA);
      tab.setAttribute("aria-selected", String(estIA));
    });
    document.querySelectorAll("[data-tab-panel]").forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-tab-panel") !== "ia";
    });

    formIA.hidden = true;
    reinitialiserFormulaire_(formIA);
    reinitialiserFormulaire_(formManuel);

    // Le texte explicatif des 3 méthodes réapparaît à chaque ouverture,
    // et disparaît dès la première interaction de l'utilisateur dans la modale.
    document.getElementById("modal-add-explication").hidden = false;
    const masquerExplication = function () {
      document.getElementById("modal-add-explication").hidden = true;
    };
    modalAddResource.addEventListener("click", masquerExplication, { once: true });
    modalAddResource.addEventListener("input", masquerExplication, { once: true });
  }

  // Clic sur "OK" de la modale de confirmation : ferme la confirmation et
  // ré-ouvre la modale d'ajout, remise à son état initial.
  document.getElementById("btn-confirmation-ajout-ok").addEventListener("click", function () {
    closeModal(document.getElementById("modal-confirmation-ajout"));
    reinitialiserModaleAjout_();
    openModal(modalAddResource);
  });

  chargerDonnees();
})();
