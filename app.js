/**
 * app.js
 *
 * Gère actuellement :
 *   1. Le switch de langue FR/EN (texte de l'interface + persistance URL ?lang=)
 *   2. L'ouverture/fermeture des modales (À propos, Signaler, Proposer une ressource)
 *   3. L'empilement de la sidebar sur mobile
 *   4. Les onglets de la modale "Proposer une ressource"
 *   5. Le chargement des données réelles (action=getData) et l'affichage
 *      des cartes-ressources, paginé 12 par 12 ("Afficher plus")
 *
 * NE FAIT PAS ENCORE (prochaines étapes) :
 *   - la génération dynamique des 8 filtres et le filtrage réel des cartes
 *   - la persistance des filtres dans l'URL (seul ?lang= est géré ici)
 *   - la modale d'ajout (IA + manuel) connectée au backend
 */

(function () {
  "use strict";

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
  }

  langToggle.addEventListener("click", () => {
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
  document.getElementById("btn-open-add-resource").addEventListener("click", () => openModal(modalAddResource));

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
    });
  });
  /* =======================================================
     5. CHARGEMENT DES DONNÉES (backend Code.gs, action=getData)
     ======================================================= */
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxD8Hf1muql7BF0qiDMlpfV038afKdIco3dIsVNwGLgyg8Ct-DoEM4fhK1ItlDg30zd/exec";
  const TAILLE_PAGE = 12; // Affichage 12 par 12, exigé par le CDC

  // Données brutes reçues une seule fois au chargement, jamais re-fetchées
  // lors du filtrage (qui doit rester exclusivement local, cf. CDC).
  let toutesLesRessources = [];
  let referentielStructure = [];
  let referentielTypes = [];
  let referentielLangues = [];

  // Pour l'instant (avant le bloc filtres), la liste affichée = liste complète.
  let ressourcesAffichees = [];
  let nombreCartesVisibles = 0;

  const grille = document.getElementById("card-grid");
  const compteurResultats = document.getElementById("result-count-number");
  const boutonAfficherPlus = document.getElementById("btn-load-more");

  function chargerDonnees() {
    fetch(APPS_SCRIPT_URL + "?action=getData")
      .then(function (reponse) { return reponse.json(); })
      .then(function (donnees) {
        if (donnees.erreur) throw new Error(donnees.erreur);

        toutesLesRessources = donnees.ressources || [];
        referentielStructure = donnees.structure || [];
        referentielTypes = donnees.types || [];
        referentielLangues = donnees.langues || [];

        ressourcesAffichees = toutesLesRessources; // sans filtre pour l'instant
        nombreCartesVisibles = 0;
        afficherLotSuivant();
      })
      .catch(function (erreur) {
        grille.innerHTML =
          '<p class="card-grid__etat">Impossible de charger les ressources (' + erreur.message + ').</p>';
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
      badge.title = theme;
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

  chargerDonnees();
})();
