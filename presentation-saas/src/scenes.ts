import narration from "./narration.json";
import { VOICE } from "./voice-data";

export type Shot = { src: string; x: number; y: number; w: number; phone?: boolean; rotY?: number; delay?: number; focus?: [number, number]; zoom?: number; tag?: string };
export type Callout = { text: string; delay: number; accent?: "em" | "ind" | "lat" };
export type Scene = {
  id: string; kind: "intro" | "module" | "outro";
  tag: string; title: string; sub: string; paths: string[]; accent: "em" | "ind" | "lat";
  shots: Shot[]; callouts: Callout[];
  caption: string; frames: number; lead: number;
};

export const FPS = 30;
const LEAD = 14, TAIL = 26; // images avant la voix, images de respiration après

const spec: Omit<Scene, "caption" | "frames" | "lead">[] = [
  { id: "s01", tag: "", kind: "intro", title: "Hotel Manager Pro", sub: "par SaaS Lab Madagascar", paths: [], accent: "em", shots: [], callouts: [] },
  { id: "s02", tag: "COMMENT Y ACCÉDER", kind: "module", title: "Accès", sub: "Dans votre navigateur, sans rien installer", paths: ["Ordinateur · Téléphone", "Créer mon établissement"], accent: "em",
    shots: [{ src: "inscription", x: 960, y: 130, w: 840, rotY: -7, delay: 8 }, { src: "connexion", x: 730, y: 290, w: 840, rotY: -7, delay: 0 }, { src: "mobile-overview", x: 1560, y: 470, w: 230, phone: true, delay: 16 }],
    callouts: [{ text: "14 jours d'essai gratuit", delay: 40, accent: "em" }, { text: "Sans carte bancaire", delay: 52, accent: "ind" }] },
  { id: "s03", tag: "MODULE 01", kind: "module", title: "Vue d'ensemble", sub: "Votre journée en un coup d'œil", paths: ["Menu › Vue d'ensemble"], accent: "em",
    shots: [{ src: "overview", x: 700, y: 140, w: 1130, rotY: -5, focus: [30, 80], zoom: 1.22 }],
    callouts: [{ text: "Occupation · Arrivées · Départs", delay: 34, accent: "em" }, { text: "Encaissements du jour", delay: 52, accent: "lat" }] },
  { id: "s04", tag: "MODULE 02", kind: "module", title: "Réservations", sub: "Zéro double réservation", paths: ["Menu › Réservations", "Nouvelle réservation"], accent: "ind",
    shots: [{ src: "reservations", x: 920, y: 120, w: 880, rotY: -6, delay: 0 }, { src: "reservation-nouvelle", x: 720, y: 290, w: 880, rotY: -6, delay: 12, focus: [30, 30], zoom: 1.12 }],
    callouts: [{ text: "Une chambre, une seule vente par nuit", delay: 50, accent: "ind" }] },
  { id: "s05", tag: "MODULE 03", kind: "module", title: "Calendrier", sub: "Toutes les chambres, nuit par nuit", paths: ["Menu › Calendrier"], accent: "em",
    shots: [{ src: "calendrier", x: 700, y: 140, w: 1130, rotY: -5, focus: [35, 30], zoom: 1.25 }],
    callouts: [{ text: "Séjours en barres de couleur", delay: 30, accent: "em" }, { text: "Blocages pour maintenance", delay: 46, accent: "lat" }] },
  { id: "s06", tag: "MODULES 04 · 05", kind: "module", title: "Chambres & Clients", sub: "Tarifs saisonniers, fiches clients", paths: ["Menu › Chambres", "Menu › Clients"], accent: "lat",
    shots: [{ src: "clients", x: 1010, y: 120, w: 800, rotY: -6, delay: 0 }, { src: "categories", x: 880, y: 250, w: 800, rotY: -6, delay: 10 }, { src: "chambres", x: 750, y: 380, w: 800, rotY: -6, delay: 20 }],
    callouts: [{ text: "Catégories · Tarifs · Saisons", delay: 44, accent: "lat" }] },
  { id: "s07", tag: "MODULE 06", kind: "module", title: "Réception", sub: "Arrivées et départs en un clic", paths: ["Menu › Réception"], accent: "em",
    shots: [{ src: "reception", x: 700, y: 140, w: 1130, rotY: -5, focus: [60, 55], zoom: 1.28 }],
    callouts: [{ text: "Arrivée · Changer de chambre", delay: 30, accent: "em" }, { text: "Encaisser · Départ", delay: 46, accent: "ind" }] },
  { id: "s08", tag: "MODULE 07", kind: "module", title: "Facturation", sub: "Ariary · Euro · Dollar", paths: ["Menu › Facturation"], accent: "lat",
    shots: [{ src: "paiements", x: 940, y: 130, w: 880, rotY: -6, delay: 0 }, { src: "factures", x: 730, y: 300, w: 880, rotY: -6, delay: 12 }],
    callouts: [{ text: "Espèces · Orange Money · MVola", delay: 36, accent: "lat" }, { text: "Factures et avoirs en PDF", delay: 52, accent: "em" }] },
  { id: "s09", tag: "MODULE 08", kind: "module", title: "Restaurant", sub: "Commandes à table, addition sur la chambre", paths: ["Menu › Restaurant"], accent: "lat",
    shots: [{ src: "carte", x: 950, y: 120, w: 860, rotY: -6, delay: 0 }, { src: "restaurant", x: 730, y: 290, w: 880, rotY: -6, delay: 10 }],
    callouts: [{ text: "Addition → chambre du client", delay: 34, accent: "lat" }] },
  { id: "s10", tag: "MODULE 09", kind: "module", title: "Housekeeping", sub: "Propre · À nettoyer · Contrôlée", paths: ["Menu › Housekeeping"], accent: "em",
    shots: [{ src: "maintenance", x: 950, y: 120, w: 860, rotY: -6, delay: 0 }, { src: "menage", x: 730, y: 290, w: 880, rotY: -6, delay: 10, focus: [45, 40], zoom: 1.15 }],
    callouts: [{ text: "Tâches et maintenance", delay: 36, accent: "em" }] },
  { id: "s11", tag: "MODULES 10 · 11 · 12", kind: "module", title: "Équipe · Finances · Rapports", sub: "Rôles, dépenses, taux d'occupation", paths: ["Menu › Personnel", "Menu › Finances", "Menu › Rapports"], accent: "ind",
    shots: [{ src: "personnel", x: 1010, y: 120, w: 800, rotY: -6, delay: 0 }, { src: "finances", x: 880, y: 250, w: 800, rotY: -6, delay: 10 }, { src: "rapports", x: 750, y: 380, w: 800, rotY: -6, delay: 20 }],
    callouts: [{ text: "Rôles et droits précis", delay: 40, accent: "ind" }] },
  { id: "s12", tag: "POUR L'ÉDITEUR", kind: "module", title: "Console éditeur", sub: "Abonnements, forfaits, licences, paiements", paths: ["Console › Tableau de bord", "Console › Paiements"], accent: "lat",
    shots: [{ src: "plat-formules", x: 1010, y: 120, w: 800, rotY: -6, delay: 0 }, { src: "plat-paiements", x: 880, y: 250, w: 800, rotY: -6, delay: 10 }, { src: "plat-dashboard", x: 750, y: 380, w: 800, rotY: -6, delay: 20 }],
    callouts: [{ text: "Valider les paiements Orange Money", delay: 44, accent: "lat" }] },
  { id: "s13", tag: "EN PLUS", kind: "module", title: "Sécurité & confort", sub: "Clair · Sombre · Ordinateur · Téléphone", paths: ["Paramètres › Mon compte"], accent: "em",
    shots: [{ src: "sombre-calendrier", x: 700, y: 160, w: 980, rotY: -5, delay: 0 }, { src: "mobile-calendrier", x: 1380, y: 330, w: 250, phone: true, delay: 14 }, { src: "mobile-reservations", x: 1640, y: 400, w: 220, phone: true, delay: 24 }],
    callouts: [{ text: "Données isolées par hôtel", delay: 34, accent: "em" }, { text: "Français · English · Malagasy", delay: 50, accent: "ind" }] },
  { id: "s14", tag: "", kind: "outro", title: "Essayez gratuitement", sub: "14 jours · sans carte bancaire", paths: [], accent: "em", shots: [], callouts: [] },
];

export const SCENES: Scene[] = spec.map((s) => {
  const v = VOICE[s.id];
  const extra = s.kind === "outro" ? 60 : s.kind === "intro" ? 8 : 0;
  return { ...s, caption: (narration as Record<string, string>)[s.id], lead: LEAD, frames: Math.ceil(v.seconds * FPS) + LEAD + TAIL + extra };
});
export const TOTAL_FRAMES = SCENES.reduce((a, s) => a + s.frames, 0);
