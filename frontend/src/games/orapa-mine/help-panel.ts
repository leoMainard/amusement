/**
 * Panneau d'aide compact (comment jouer + toutes les couleurs) ouvert
 * via un bouton "❔ Aide" — même contenu en jeu (multiplayer.ts) et
 * dans le guide (pages/guide/orapa-mine.ts), pour ne pas répéter tout
 * le texte explicatif directement dans chaque écran. S'appuie sur
 * `<dialog>` natif : fermeture au clic dehors et à Échap gratuites, pas
 * de piège de focus à gérer à la main.
 */

import { colorComboGalleryHtml } from "./color-combos";

export interface HelpDialog {
  open: () => void;
  dispose: () => void;
}

export function mountHelpDialog(root: HTMLElement): HelpDialog {
  const dialog = document.createElement("dialog");
  dialog.className = "om-help-dialog";
  dialog.innerHTML = `
    <div class="om-help-dialog__inner">
      <button type="button" class="om-help-dialog__close" aria-label="Fermer">✕</button>
      <h3>Comment jouer</h3>
      <ul class="om-help-dialog__rules">
        <li><strong>Tirer un rayon</strong> : clique un point d'entrée du plateau (ou saisis-le, ex. « 7 » ou « K »), puis « Envoyer » — il rebondit sur les gemmes qu'il croise et ressort teinté.</li>
        <li><strong>Interroger une case</strong> : clique une case, puis « Demander » — on te dit directement ce qu'elle contient.</li>
        <li><strong>Pivoter / retourner</strong> une gemme avant de la poser : boutons dédiés, ou les touches <kbd>R</kbd> / <kbd>F</kbd> au clavier.</li>
        <li><strong>Retirer</strong> une gemme déjà posée : reclique dessus sur le plateau.</li>
        <li><strong>Désélectionner</strong> une gemme ou un repère armé sans le poser : reclique-le dans la palette, ou appuie sur <kbd>Échap</kbd>.</li>
        <li><strong>Proposer la disposition</strong> quand tu penses savoir où sont les gemmes — deux essais avant d'être définitivement éliminé (voir la notice pour le détail).</li>
      </ul>
      <h3>Les couleurs</h3>
      <p class="om-help-dialog__hint">
        Le rayon se teinte selon les gemmes colorées qu'il touche en chemin — toutes les
        combinaisons possibles :
      </p>
      <ul class="notice__combo-gallery om-help-dialog__combos">${colorComboGalleryHtml()}</ul>
    </div>
  `;
  root.appendChild(dialog);

  dialog.querySelector<HTMLButtonElement>(".om-help-dialog__close")!.addEventListener("click", () => dialog.close());
  // Le `<dialog>` lui-même occupe toute la fenêtre (son "backdrop") : un
  // clic dessus (donc en dehors de `.om-help-dialog__inner`) ferme,
  // comme Échap (géré nativement par `<dialog>`).
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  return {
    open: () => dialog.showModal(),
    dispose: () => dialog.remove(),
  };
}
