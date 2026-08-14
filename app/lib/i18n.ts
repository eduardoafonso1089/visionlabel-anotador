export type Language = "pt" | "en" | "fr" | "es";
export type ThemeMode = "system" | "light" | "dark";

const pt = {
  saved: "Salvo neste dispositivo", saving: "Salvando…", samActive: "SAM local ativo", activateSam: "Ativar SAM local",
  export: "Exportar", exportFormat: "Formato de exportação", cocoDesc: "caixas, polígonos e pontos-chave", yoloDesc: "um label por imagem + data.yaml", projectBackup: "backup editável",
  images: "IMAGENS", openImages: "Abrir imagens", importImages: "Importar imagens", searchImage: "Buscar imagem…", progress: "Progresso", of: "de", localImage: "Imagem local", privacy: "Suas imagens ficam no navegador.",
  select: "Selecionar e mover (V)", pan: "Mover canvas (H)", box: "Caixa (B)", polygon: "Polígono por pontos (P)", freehand: "Polígono à mão livre (F)", point: "Ponto-chave (K)", sam: "Segmentar com SAM (S)",
  simplify: "Simplificar polígono", duplicate: "Duplicar polígono", merge: "Unir polígonos selecionados", split: "Cortar polígono com linha", transform: "Rotacionar e redimensionar (T)", reshape: "Remodelar borda à mão livre (R)", snapOn: "Encaixe em vértices e arestas ativo", snapOff: "Ativar encaixe em vértices e arestas",
  undo: "Desfazer", redo: "Refazer", deleteShape: "Excluir forma inteira", resetZoom: "Redefinir zoom", shortcuts: "Atalhos",
  classes: "Classes", quality: "Qualidade", activeClass: "CLASSE ATIVA", newShapesClass: "Novas formas usarão esta classe.", newClass: "Nova classe", className: "Nome da classe", add: "Adicionar", cancel: "Cancelar", annotations: "ANOTAÇÕES",
  projectCurrent: "Projeto atual", renameProject: "Renomear projeto", viewImages: "Ver imagens", projectImages: "imagens", projectAnnotations: "anotações", save: "Salvar",
  labelStudio: "Criação rápida de labels", labelStudioHint: "Digite, escolha a cor e pressione Enter.", labelColor: "Cor da classe", createLabel: "Criar label", batchSelection: "selecionadas", changeClass: "Trocar classe do grupo", applyClass: "Aplicar", middlePan: "Scroll pressionado move a imagem em qualquer ferramenta",
  quickTip: "Dica rápida", vectorEditing: "Edição vetorial estilo QGIS", vectorHint: "Mova e encaixe vértices, remodele bordas, transforme, simplifique, una ou corte pela barra superior.", shortcutHint: "Use B, P, F, K e S para anotar sem tirar a mão do teclado.",
  hideAnnotation: "Ocultar anotação", showAnnotation: "Mostrar anotação", hideClass: "Ocultar classe", showClass: "Mostrar classe",
  preferences: "Preferências", appearance: "Aparência", language: "Idioma", system: "Sistema", light: "Claro", dark: "Escuro", close: "Fechar",
  polygonFinish: "direito, Enter ou ponto inicial para concluir · Esc cancelar", freehandStart: "clique esquerdo inicia sem precisar manter pressionado", freehandFinish: "Mova o mouse pelo contorno · botão direito fecha o polígono", splitTip: "Arraste uma linha de uma borda à outra do polígono", transformTip: "Arraste o círculo superior para girar · arraste o canto para redimensionar",
  reshapeStart: "Primeiro clique dentro para adicionar ou fora para remover · não mantenha pressionado", reshapeAdd: "Início dentro: saia do objeto e clique dentro novamente para adicionar", reshapeDelete: "Início fora: atravesse o objeto e clique fora novamente para remover",
  ready: "Pronta para anotar", imageAnnotations: "anotações nesta imagem", selectedObjects: "objetos selecionados", selecting: "Arraste para selecionar objetos", moving: "Movendo anotações…", reshaping: "Remodelando borda…", transforming: "Transformando polígono…",
  goodConsistency: "Boa consistência", possibleOverlap: "1 possível sobreposição", overlapText: "Revise a anotação perto da borda direita.", validClasses: "Classes válidas", validClassesText: "Todas as formas possuem uma classe.", noEmpty: "Sem formas vazias", noEmptyText: "Nenhuma área inválida foi detectada.", review: "Revisar apontamento",
  samTitle: "SAM local, sem token", samSubtitle: "O modelo e as imagens permanecem no seu computador.", beforeRun: "Antes de rodar", quickSetup: "Configuração rápida", checkpointPage: "Abrir página oficial dos checkpoints", connectorDownload: "Baixar conector local", localAddress: "Endereço local", noUpload: "Sem upload e sem credenciais", verifyUse: "Verificar e usar",
};

export type TranslationKey = keyof typeof pt;

const translations: Record<Language, Record<TranslationKey, string>> = {
  pt,
  en: {
    saved: "Saved on this device", saving: "Saving…", samActive: "Local SAM active", activateSam: "Enable local SAM",
    export: "Export", exportFormat: "Export format", cocoDesc: "boxes, polygons and keypoints", yoloDesc: "one label per image + data.yaml", projectBackup: "editable backup",
    images: "IMAGES", openImages: "Open images", importImages: "Import images", searchImage: "Search image…", progress: "Progress", of: "of", localImage: "Local image", privacy: "Your images stay in the browser.",
    select: "Select and move (V)", pan: "Pan canvas (H)", box: "Box (B)", polygon: "Point polygon (P)", freehand: "Freehand polygon (F)", point: "Keypoint (K)", sam: "Segment with SAM (S)",
    simplify: "Simplify polygon", duplicate: "Duplicate polygon", merge: "Merge selected polygons", split: "Split polygon with line", transform: "Rotate and resize (T)", reshape: "Freehand reshape (R)", snapOn: "Vertex and edge snapping active", snapOff: "Enable vertex and edge snapping",
    undo: "Undo", redo: "Redo", deleteShape: "Delete entire shape", resetZoom: "Reset zoom", shortcuts: "Shortcuts",
    classes: "Classes", quality: "Quality", activeClass: "ACTIVE CLASS", newShapesClass: "New shapes will use this class.", newClass: "New class", className: "Class name", add: "Add", cancel: "Cancel", annotations: "ANNOTATIONS",
    projectCurrent: "Current project", renameProject: "Rename project", viewImages: "View images", projectImages: "images", projectAnnotations: "annotations", save: "Save",
    labelStudio: "Quick label creation", labelStudioHint: "Type, choose a color and press Enter.", labelColor: "Class color", createLabel: "Create label", batchSelection: "selected", changeClass: "Change group class", applyClass: "Apply", middlePan: "Hold the mouse wheel to pan with any tool",
    quickTip: "Quick tip", vectorEditing: "QGIS-style vector editing", vectorHint: "Move and snap vertices, reshape, transform, simplify, merge or split from the toolbar.", shortcutHint: "Use B, P, F, K and S to annotate without leaving the keyboard.",
    hideAnnotation: "Hide annotation", showAnnotation: "Show annotation", hideClass: "Hide class", showClass: "Show class",
    preferences: "Preferences", appearance: "Appearance", language: "Language", system: "System", light: "Light", dark: "Dark", close: "Close",
    polygonFinish: "right click, Enter or first point to finish · Esc cancels", freehandStart: "left click starts without holding", freehandFinish: "Move around the outline · right click closes the polygon", splitTip: "Drag a line from one polygon edge to another", transformTip: "Drag the top circle to rotate · drag the corner to resize",
    reshapeStart: "First click inside to add or outside to remove · do not hold", reshapeAdd: "Started inside: leave the object and click inside again to add", reshapeDelete: "Started outside: cross the object and click outside again to remove",
    ready: "Ready to annotate", imageAnnotations: "annotations in this image", selectedObjects: "objects selected", selecting: "Drag to select objects", moving: "Moving annotations…", reshaping: "Reshaping boundary…", transforming: "Transforming polygon…",
    goodConsistency: "Good consistency", possibleOverlap: "1 possible overlap", overlapText: "Review the annotation near the right edge.", validClasses: "Valid classes", validClassesText: "All shapes have a class.", noEmpty: "No empty shapes", noEmptyText: "No invalid area was detected.", review: "Review finding",
    samTitle: "Local SAM, no token", samSubtitle: "The model and images stay on your computer.", beforeRun: "Before running", quickSetup: "Quick setup", checkpointPage: "Open official checkpoint page", connectorDownload: "Download local connector", localAddress: "Local address", noUpload: "No upload and no credentials", verifyUse: "Verify and use",
  },
  fr: {
    saved: "Enregistré sur cet appareil", saving: "Enregistrement…", samActive: "SAM local actif", activateSam: "Activer le SAM local",
    export: "Exporter", exportFormat: "Format d’export", cocoDesc: "boîtes, polygones et points clés", yoloDesc: "une étiquette par image + data.yaml", projectBackup: "sauvegarde modifiable",
    images: "IMAGES", openImages: "Ouvrir les images", importImages: "Importer des images", searchImage: "Rechercher une image…", progress: "Progression", of: "sur", localImage: "Image locale", privacy: "Vos images restent dans le navigateur.",
    select: "Sélectionner et déplacer (V)", pan: "Déplacer le canevas (H)", box: "Rectangle (B)", polygon: "Polygone par points (P)", freehand: "Polygone à main levée (F)", point: "Point clé (K)", sam: "Segmenter avec SAM (S)",
    simplify: "Simplifier le polygone", duplicate: "Dupliquer le polygone", merge: "Fusionner les polygones", split: "Découper avec une ligne", transform: "Faire pivoter et redimensionner (T)", reshape: "Remodeler à main levée (R)", snapOn: "Accrochage aux sommets et arêtes actif", snapOff: "Activer l’accrochage",
    undo: "Annuler", redo: "Rétablir", deleteShape: "Supprimer la forme", resetZoom: "Réinitialiser le zoom", shortcuts: "Raccourcis",
    classes: "Classes", quality: "Qualité", activeClass: "CLASSE ACTIVE", newShapesClass: "Les nouvelles formes utiliseront cette classe.", newClass: "Nouvelle classe", className: "Nom de la classe", add: "Ajouter", cancel: "Annuler", annotations: "ANNOTATIONS",
    projectCurrent: "Projet actuel", renameProject: "Renommer le projet", viewImages: "Voir les images", projectImages: "images", projectAnnotations: "annotations", save: "Enregistrer",
    labelStudio: "Création rapide d’étiquettes", labelStudioHint: "Saisissez, choisissez la couleur et appuyez sur Entrée.", labelColor: "Couleur de classe", createLabel: "Créer l’étiquette", batchSelection: "sélectionnées", changeClass: "Changer la classe du groupe", applyClass: "Appliquer", middlePan: "Maintenez la molette pour déplacer avec tout outil",
    quickTip: "Astuce", vectorEditing: "Édition vectorielle type QGIS", vectorHint: "Déplacez et accrochez les sommets, remodelez, transformez, simplifiez, fusionnez ou découpez.", shortcutHint: "Utilisez B, P, F, K et S pour annoter au clavier.",
    hideAnnotation: "Masquer l’annotation", showAnnotation: "Afficher l’annotation", hideClass: "Masquer la classe", showClass: "Afficher la classe",
    preferences: "Préférences", appearance: "Apparence", language: "Langue", system: "Système", light: "Clair", dark: "Sombre", close: "Fermer",
    polygonFinish: "clic droit, Entrée ou premier point pour terminer · Échap annule", freehandStart: "un clic gauche démarre sans maintenir", freehandFinish: "Suivez le contour · un clic droit ferme le polygone", splitTip: "Tracez une ligne d’un bord à l’autre", transformTip: "Faites glisser le cercle supérieur pour tourner · le coin pour redimensionner",
    reshapeStart: "Premier clic dedans pour ajouter ou dehors pour retirer · ne maintenez pas", reshapeAdd: "Départ intérieur : sortez puis cliquez de nouveau à l’intérieur pour ajouter", reshapeDelete: "Départ extérieur : traversez puis cliquez de nouveau à l’extérieur pour retirer",
    ready: "Prêt à annoter", imageAnnotations: "annotations dans cette image", selectedObjects: "objets sélectionnés", selecting: "Faites glisser pour sélectionner", moving: "Déplacement des annotations…", reshaping: "Remodelage du bord…", transforming: "Transformation du polygone…",
    goodConsistency: "Bonne cohérence", possibleOverlap: "1 chevauchement possible", overlapText: "Vérifiez l’annotation près du bord droit.", validClasses: "Classes valides", validClassesText: "Toutes les formes ont une classe.", noEmpty: "Aucune forme vide", noEmptyText: "Aucune zone invalide détectée.", review: "Vérifier",
    samTitle: "SAM local, sans jeton", samSubtitle: "Le modèle et les images restent sur votre ordinateur.", beforeRun: "Avant de lancer", quickSetup: "Configuration rapide", checkpointPage: "Ouvrir la page officielle des checkpoints", connectorDownload: "Télécharger le connecteur local", localAddress: "Adresse locale", noUpload: "Sans envoi et sans identifiants", verifyUse: "Vérifier et utiliser",
  },
  es: {
    saved: "Guardado en este dispositivo", saving: "Guardando…", samActive: "SAM local activo", activateSam: "Activar SAM local",
    export: "Exportar", exportFormat: "Formato de exportación", cocoDesc: "cajas, polígonos y puntos clave", yoloDesc: "una etiqueta por imagen + data.yaml", projectBackup: "copia editable",
    images: "IMÁGENES", openImages: "Abrir imágenes", importImages: "Importar imágenes", searchImage: "Buscar imagen…", progress: "Progreso", of: "de", localImage: "Imagen local", privacy: "Tus imágenes permanecen en el navegador.",
    select: "Seleccionar y mover (V)", pan: "Mover lienzo (H)", box: "Rectángulo (B)", polygon: "Polígono por puntos (P)", freehand: "Polígono a mano alzada (F)", point: "Punto clave (K)", sam: "Segmentar con SAM (S)",
    simplify: "Simplificar polígono", duplicate: "Duplicar polígono", merge: "Unir polígonos seleccionados", split: "Cortar con una línea", transform: "Rotar y redimensionar (T)", reshape: "Remodelar a mano alzada (R)", snapOn: "Ajuste a vértices y bordes activo", snapOff: "Activar ajuste a vértices y bordes",
    undo: "Deshacer", redo: "Rehacer", deleteShape: "Eliminar forma completa", resetZoom: "Restablecer zoom", shortcuts: "Atajos",
    classes: "Clases", quality: "Calidad", activeClass: "CLASE ACTIVA", newShapesClass: "Las formas nuevas usarán esta clase.", newClass: "Nueva clase", className: "Nombre de la clase", add: "Añadir", cancel: "Cancelar", annotations: "ANOTACIONES",
    projectCurrent: "Proyecto actual", renameProject: "Renombrar proyecto", viewImages: "Ver imágenes", projectImages: "imágenes", projectAnnotations: "anotaciones", save: "Guardar",
    labelStudio: "Creación rápida de etiquetas", labelStudioHint: "Escribe, elige el color y pulsa Enter.", labelColor: "Color de clase", createLabel: "Crear etiqueta", batchSelection: "seleccionadas", changeClass: "Cambiar clase del grupo", applyClass: "Aplicar", middlePan: "Mantén pulsada la rueda para mover con cualquier herramienta",
    quickTip: "Consejo rápido", vectorEditing: "Edición vectorial estilo QGIS", vectorHint: "Mueve y ajusta vértices, remodela, transforma, simplifica, une o corta desde la barra.", shortcutHint: "Usa B, P, F, K y S para anotar con el teclado.",
    hideAnnotation: "Ocultar anotación", showAnnotation: "Mostrar anotación", hideClass: "Ocultar clase", showClass: "Mostrar clase",
    preferences: "Preferencias", appearance: "Apariencia", language: "Idioma", system: "Sistema", light: "Claro", dark: "Oscuro", close: "Cerrar",
    polygonFinish: "clic derecho, Enter o punto inicial para terminar · Esc cancela", freehandStart: "un clic izquierdo inicia sin mantener", freehandFinish: "Mueve por el contorno · clic derecho cierra el polígono", splitTip: "Arrastra una línea de un borde del polígono al otro", transformTip: "Arrastra el círculo superior para rotar · la esquina para cambiar tamaño",
    reshapeStart: "Primer clic dentro para añadir o fuera para quitar · no mantengas", reshapeAdd: "Inicio dentro: sal del objeto y haz clic dentro de nuevo para añadir", reshapeDelete: "Inicio fuera: cruza el objeto y haz clic fuera de nuevo para quitar",
    ready: "Lista para anotar", imageAnnotations: "anotaciones en esta imagen", selectedObjects: "objetos seleccionados", selecting: "Arrastra para seleccionar objetos", moving: "Moviendo anotaciones…", reshaping: "Remodelando borde…", transforming: "Transformando polígono…",
    goodConsistency: "Buena consistencia", possibleOverlap: "1 posible superposición", overlapText: "Revisa la anotación cerca del borde derecho.", validClasses: "Clases válidas", validClassesText: "Todas las formas tienen una clase.", noEmpty: "Sin formas vacías", noEmptyText: "No se detectó ningún área inválida.", review: "Revisar",
    samTitle: "SAM local, sin token", samSubtitle: "El modelo y las imágenes permanecen en tu ordenador.", beforeRun: "Antes de ejecutar", quickSetup: "Configuración rápida", checkpointPage: "Abrir página oficial de checkpoints", connectorDownload: "Descargar conector local", localAddress: "Dirección local", noUpload: "Sin subida y sin credenciales", verifyUse: "Verificar y usar",
  },
};

export function getCopy(language: Language) {
  return translations[language];
}
