/**
 * app.js — squelette d'interactivité
 *
 * À ce stade, ce fichier gère UNIQUEMENT :
 *   1. Le switch de langue FR/EN (texte de l'interface + persistance URL ?lang=)
 *   2. L'ouverture/fermeture des modales (À propos, Signaler, Proposer une ressource)
 *   3. L'empilement de la sidebar sur mobile
 *   4. Les onglets de la modale "Proposer une ressource"
 *
 * NE FAIT PAS ENCORE (prochaines étapes) :
 *   - la génération dynamique des filtres depuis le Google Sheet
 *   - le filtrage réel des cartes
 *   - les appels au backend Code.gs (lecture IA, écriture de ressource)
 *   - la persistance des filtres dans l'URL (seul ?lang= est géré ici)
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
})();
