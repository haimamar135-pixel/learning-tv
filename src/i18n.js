/* ─── שפת הממשק (צ'אט 25 · השורש האוניברסלי, שלב 1) ───
   העברית היא המקור: בקוד כותבים tx("טקסט בעברית"), והטבלה כאן מתרגמת אותו.
   מחרוזת שאין לה תרגום — מוצגת בעברית (כך שום דבר לא נשבר באמצע הדרך).
   כל שורה בטבלה: [עברית, English, العربية, Français, Español, Русский, Deutsch].
   שפה חדשה = עמודה נוספת כאן + שורה ב-LANGS. אין צורך לגעת ב-App.jsx.
   הבחירה נשמרת במכשיר ב-lomedtv-lang. */

export const LANGS = [
  ["he", "עברית", "rtl"],
  ["en", "English", "ltr"],
  ["ar", "العربية", "rtl"],
  ["fr", "Français", "ltr"],
  ["es", "Español", "ltr"],
  ["ru", "Русский", "ltr"],
  ["de", "Deutsch", "ltr"],
];
const COLS = ["he", "en", "ar", "fr", "es", "ru", "de"];

const T = [
  /* ── כללי ── */
  ["מסך הלמידה", "Lomed TV", "Lomed TV", "Lomed TV", "Lomed TV", "Lomed TV", "Lomed TV"],
  ["חברותא שלא הולכת הביתה", "A study partner that never goes home", "رفيق دراسة لا يغادر", "Un compagnon d'étude qui ne rentre jamais chez lui", "Un compañero de estudio que nunca se va a casa", "Напарник по учёбе, который не уходит домой", "Ein Lernpartner, der nie nach Hause geht"],
  ["כל טקסט הופך לשבעה ערוצי לימוד", "Every text becomes seven channels of learning", "كل نص يتحوّل إلى سبع قنوات للتعلّم", "Chaque texte devient sept chaînes d'étude", "Cada texto se convierte en siete canales de estudio", "Любой текст превращается в семь каналов изучения", "Jeder Text wird zu sieben Lernkanälen"],
  ["לומד", "Learner", "دارس", "Étudiant", "Estudiante", "Учащийся", "Lernender"],
  ["אתה", "You", "أنت", "Vous", "Tú", "Вы", "Du"],
  ["שגיאה", "Error", "خطأ", "Erreur", "Error", "Ошибка", "Fehler"],
  ["שגיאה: ", "Error: ", "خطأ: ", "Erreur : ", "Error: ", "Ошибка: ", "Fehler: "],
  ["סגור", "Close", "إغلاق", "Fermer", "Cerrar", "Закрыть", "Schließen"],
  ["לא עכשיו", "Not now", "ليس الآن", "Pas maintenant", "Ahora no", "Не сейчас", "Nicht jetzt"],
  ["ללא שם", "Untitled", "بلا عنوان", "Sans titre", "Sin título", "Без названия", "Ohne Titel"],
  ["חדש", "New", "جديد", "Nouveau", "Nuevo", "Новое", "Neu"],
  ["ספר", "Book", "كتاب", "Livre", "Libro", "Книга", "Buch"],
  ["בטוח?", "Sure?", "متأكد؟", "Sûr ?", "¿Seguro?", "Точно?", "Sicher?"],

  /* ── מסך הפתיחה ── */
  ["מתי בפעם האחרונה", "When was the last time", "متى كانت آخر مرة", "À quand remonte la dernière fois", "¿Cuándo fue la última vez", "Когда в последний раз", "Wann hat dir zuletzt"],
  ["ספר ענה לך בחזרה?", "a book answered you back?", "أجابك فيها كتاب؟", "qu'un livre vous a répondu ?", "que un libro te respondió?", "книга ответила вам?", "ein Buch geantwortet?"],
  ["יש לך ספרים שאתה חוזר אליהם שנים. הידע שלך גדל — והספר לא יודע מזה כלום. עד היום.", "There are books you have returned to for years. Your knowledge keeps growing — and the book knows nothing about it. Until today.", "لديك كتب تعود إليها منذ سنوات. معرفتك تكبر — والكتاب لا يعلم شيئًا عن ذلك. حتى اليوم.", "Il y a des livres auxquels vous revenez depuis des années. Votre savoir grandit — et le livre n'en sait rien. Jusqu'à aujourd'hui.", "Hay libros a los que vuelves desde hace años. Tu conocimiento crece — y el libro no sabe nada de ello. Hasta hoy.", "Есть книги, к которым вы возвращаетесь годами. Ваши знания растут — а книга ничего об этом не знает. До сегодняшнего дня.", "Es gibt Bücher, zu denen du seit Jahren zurückkehrst. Dein Wissen wächst — und das Buch weiß nichts davon. Bis heute."],
  ["מה השאלה שאתה נושא איתך אל הספר?", "What question are you bringing to the book?", "ما السؤال الذي تحمله معك إلى الكتاب؟", "Quelle question apportez-vous au livre ?", "¿Qué pregunta le traes al libro?", "С каким вопросом вы приходите к книге?", "Welche Frage bringst du zum Buch mit?"],
  ["למשל: מה חובתי בעולמי?", "For example: what is my task in this world?", "مثلًا: ما واجبي في عالمي؟", "Par exemple : quelle est ma tâche dans ce monde ?", "Por ejemplo: ¿cuál es mi tarea en este mundo?", "Например: в чём моя задача в этом мире?", "Zum Beispiel: Was ist meine Aufgabe in dieser Welt?"],
  ["היכנס עם השאלה", "Enter with the question", "ادخل مع السؤال", "Entrer avec la question", "Entrar con la pregunta", "Войти с вопросом", "Mit der Frage eintreten"],
  ["אפשר גם", "You can also", "يمكنك أيضًا", "Vous pouvez aussi", "También puedes", "Можно также", "Du kannst auch"],
  ["להיכנס בלי שאלה", "enter without a question", "الدخول بلا سؤال", "entrer sans question", "entrar sin pregunta", "войти без вопроса", "ohne Frage eintreten"],
  ["— היא תגיע מתוך הלימוד", "— it will come out of the learning", "— سيأتي من داخل الدراسة", "— elle viendra de l'étude elle-même", "— llegará desde el estudio mismo", "— он появится в ходе изучения", "— sie kommt aus dem Lernen selbst"],
  ["חמישה שערים אל הספר", "Five gates into the book", "خمسة أبواب إلى الكتاب", "Cinq portes vers le livre", "Cinco puertas hacia el libro", "Пять врат в книгу", "Fünf Tore zum Buch"],
  ["מכל מקום שבו המציאות פוגשת אותך — היא נכנסת אל הדף", "Wherever reality meets you — it enters the page", "أينما التقاك الواقع — يدخل إلى الصفحة", "Où que la réalité vous rencontre — elle entre dans la page", "Dondequiera que la realidad te encuentre — entra en la página", "Где бы вас ни застала реальность — она входит на страницу", "Wo immer dir die Wirklichkeit begegnet — sie tritt in die Seite ein"],
  ["הדבק טקסט", "Paste text", "الصق نصًا", "Coller un texte", "Pegar texto", "Вставить текст", "Text einfügen"],
  ["צלם דף", "Photograph a page", "صوّر صفحة", "Photographier une page", "Fotografiar una página", "Сфотографировать страницу", "Seite fotografieren"],
  ["הקלט שיעור", "Record a lesson", "سجّل درسًا", "Enregistrer un cours", "Grabar una clase", "Записать урок", "Lektion aufnehmen"],
  ["צלם וידאו", "Record video", "صوّر فيديو", "Filmer une vidéo", "Grabar vídeo", "Снять видео", "Video aufnehmen"],
  ["קובץ שמע/וידאו", "Audio/video file", "ملف صوت/فيديو", "Fichier audio/vidéo", "Archivo de audio/vídeo", "Аудио- или видеофайл", "Audio-/Videodatei"],
  ["יש כאן מי שמחכה ללמוד איתך.", "Someone here is waiting to learn with you.", "هنا من ينتظر أن يتعلّم معك.", "Quelqu'un ici attend d'étudier avec vous.", "Aquí hay alguien esperando para estudiar contigo.", "Здесь кто-то ждёт, чтобы учиться вместе с вами.", "Hier wartet jemand darauf, mit dir zu lernen."],
  ["בְּפִיךָ וּבִלְבָבְךָ · הלימוד קרוב", "In your mouth and in your heart · learning is near", "في فمك وفي قلبك · التعلّم قريب", "Dans ta bouche et dans ton cœur · l'étude est proche", "En tu boca y en tu corazón · el estudio está cerca", "В устах твоих и в сердце твоём · учение близко", "In deinem Mund und in deinem Herzen · das Lernen ist nah"],
  ["↩ לספרייה שלי ({n})", "↩ To my library ({n})", "↩ إلى مكتبتي ({n})", "↩ Vers ma bibliothèque ({n})", "↩ A mi biblioteca ({n})", "↩ В мою библиотеку ({n})", "↩ Zu meiner Bibliothek ({n})"],
  ["חזרה למסך הפתיחה", "Back to the opening screen", "العودة إلى شاشة البداية", "Retour à l'écran d'accueil", "Volver a la pantalla de inicio", "Назад к начальному экрану", "Zurück zum Startbildschirm"],
  ["ל · הפנים", "⌂ Opening", "⌂ البداية", "⌂ Accueil", "⌂ Inicio", "⌂ Начало", "⌂ Start"],

  /* ── כותרת המסך וסרגל הכלים ── */
  ["בחר ערוץ", "Choose a channel", "اختر قناة", "Choisir une chaîne", "Elige un canal", "Выберите канал", "Kanal wählen"],
  ["מגילה · לימוד גמיש", "Scroll · flexible study", "لفافة · دراسة مرنة", "Rouleau · étude libre", "Rollo · estudio flexible", "Свиток · свободное изучение", "Rolle · freies Lernen"],
  ["לוח שידורים", "Programme guide", "جدول البث", "Grille des programmes", "Guía de programación", "Программа передач", "Programmübersicht"],
  ["ספריית השידורים", "Library", "المكتبة", "Bibliothèque", "Biblioteca", "Библиотека", "Bibliothek"],
  ["שיקוף · אור חוזר", "Reflection", "انعكاس", "Reflet", "Reflejo", "Отражение", "Spiegelung"],
  ["ארון הספרים · ייבוא ללימוד", "Bookshelf · import for study", "خزانة الكتب · استيراد للدراسة", "Étagère · importer pour l'étude", "Estantería · importar para estudiar", "Книжный шкаф · импорт для изучения", "Bücherschrank · Import zum Lernen"],
  ["קליטת טקסט", "New text", "نص جديد", "Nouveau texte", "Nuevo texto", "Новый текст", "Neuer Text"],
  ["הקטנת טקסט", "Smaller text", "تصغير النص", "Texte plus petit", "Texto más pequeño", "Уменьшить текст", "Text verkleinern"],
  ["הגדלת טקסט", "Larger text", "تكبير النص", "Texte plus grand", "Texto más grande", "Увеличить текст", "Text vergrößern"],
  ["אַ−", "A−", "A−", "A−", "A−", "A−", "A−"],
  ["אַ+", "A+", "A+", "A+", "A+", "A+", "A+"],
  ["יציאה ממסך מלא", "Exit full screen", "الخروج من ملء الشاشة", "Quitter le plein écran", "Salir de pantalla completa", "Выйти из полноэкранного режима", "Vollbild beenden"],
  ["מסך מלא — הטלוויזיה על כל המסך", "Full screen — the TV fills the display", "ملء الشاشة — التلفاز على كامل الشاشة", "Plein écran — la télé occupe tout l'écran", "Pantalla completa — la tele ocupa toda la pantalla", "Во весь экран — телевизор занимает весь дисплей", "Vollbild — der Fernseher füllt den ganzen Bildschirm"],
  ["מסך מלא", "Full screen", "ملء الشاشة", "Plein écran", "Pantalla completa", "Во весь экран", "Vollbild"],
  ["הרקע מסביב לטלוויזיה", "Background around the TV", "الخلفية حول التلفاز", "Arrière-plan autour de la télé", "Fondo alrededor de la tele", "Фон вокруг телевизора", "Hintergrund um den Fernseher"],
  ["הרקע מסביב לטלוויזיה:", "Background around the TV:", "الخلفية حول التلفاز:", "Arrière-plan autour de la télé :", "Fondo alrededor de la tele:", "Фон вокруг телевизора:", "Hintergrund um den Fernseher:"],
  ["רקע", "Background", "الخلفية", "Arrière-plan", "Fondo", "Фон", "Hintergrund"],
  ["הדפסת התוכן המוצג", "Print what is shown", "طباعة المحتوى المعروض", "Imprimer le contenu affiché", "Imprimir el contenido mostrado", "Напечатать показанное", "Angezeigten Inhalt drucken"],
  ["הדפסה", "Print", "طباعة", "Imprimer", "Imprimir", "Печать", "Drucken"],
  ["גיבוי: הורדת כל הספרים, ההערות והמרקרים לקובץ", "Backup: download all books, notes and highlights to a file", "نسخة احتياطية: تنزيل كل الكتب والملاحظات والتظليلات في ملف", "Sauvegarde : télécharger tous les livres, notes et surlignages dans un fichier", "Copia de seguridad: descargar todos los libros, notas y subrayados a un archivo", "Резервная копия: скачать все книги, заметки и выделения в файл", "Sicherung: alle Bücher, Notizen und Markierungen in eine Datei herunterladen"],
  ["גיבוי", "Backup", "نسخة احتياطية", "Sauvegarde", "Copia de seguridad", "Резервная копия", "Sicherung"],
  ["שחזור מקובץ גיבוי", "Restore from a backup file", "استعادة من ملف نسخة احتياطية", "Restaurer depuis un fichier de sauvegarde", "Restaurar desde un archivo de copia", "Восстановить из файла резервной копии", "Aus einer Sicherungsdatei wiederherstellen"],
  ["שחזור", "Restore", "استعادة", "Restaurer", "Restaurar", "Восстановить", "Wiederherstellen"],
  ["חזרה ללימוד", "Back to study", "العودة إلى الدراسة", "Retour à l'étude", "Volver al estudio", "Назад к изучению", "Zurück zum Lernen"],
  ["המדריך: איך משתמשים", "Guide: how to use the app", "الدليل: كيفية الاستخدام", "Guide : mode d'emploi", "Guía: cómo se usa", "Руководство: как пользоваться", "Anleitung: So funktioniert die App"],
  ["המדריך", "Guide", "الدليل", "Guide", "Guía", "Руководство", "Anleitung"],
  ["המילון הארמי מוצג — לחץ להסתיר", "Aramaic glossary is shown — click to hide", "المعجم الآرامي معروض — اضغط للإخفاء", "Glossaire araméen affiché — cliquer pour masquer", "Glosario arameo visible — pulsa para ocultar", "Арамейский словарь показан — нажмите, чтобы скрыть", "Aramäisches Glossar wird angezeigt — zum Ausblenden klicken"],
  ["מילון ארמי: פירוש עברי קצר מתחת לכל מילה ארמית", "Aramaic glossary: a short Hebrew gloss under each Aramaic word", "معجم آرامي: شرح عبري قصير تحت كل كلمة آرامية", "Glossaire araméen : courte glose en hébreu sous chaque mot araméen", "Glosario arameo: breve glosa en hebreo bajo cada palabra aramea", "Арамейский словарь: краткое пояснение на иврите под каждым арамейским словом", "Aramäisches Glossar: kurze hebräische Erklärung unter jedem aramäischen Wort"],
  ["מילון ארמי", "Aramaic glossary", "معجم آرامي", "Glossaire araméen", "Glosario arameo", "Арамейский словарь", "Aramäisches Glossar"],
  ["הניקוד מוצג — לחץ להסתיר", "Vowel points are shown — click to hide", "التشكيل معروض — اضغط للإخفاء", "Voyelles affichées — cliquer pour masquer", "Vocalización visible — pulsa para ocultar", "Огласовки показаны — нажмите, чтобы скрыть", "Vokalzeichen werden angezeigt — zum Ausblenden klicken"],
  ["הוסף ניקוד לטקסט שאינו מנוקד (הסולם, פירושים)", "Add vowel points to unpointed Hebrew text", "أضف التشكيل إلى نص عبري غير مشكول", "Ajouter les voyelles à un texte hébreu non vocalisé", "Añadir vocalización a un texto hebreo sin puntuar", "Добавить огласовки к неогласованному тексту на иврите", "Vokalzeichen zu unpunktiertem hebräischem Text hinzufügen"],
  ["ניקוד", "Vowel points", "التشكيل", "Voyelles", "Vocalización", "Огласовки", "Vokalzeichen"],
  ["שכבת הלומד מוצגת — לחץ להסתיר", "Your layer is shown — click to hide", "طبقتك معروضة — اضغط للإخفاء", "Votre calque est affiché — cliquer pour masquer", "Tu capa está visible — pulsa para ocultar", "Ваш слой показан — нажмите, чтобы скрыть", "Deine Ebene wird angezeigt — zum Ausblenden klicken"],
  ["שכבת הלומד מוסתרת — לחץ להציג", "Your layer is hidden — click to show", "طبقتك مخفية — اضغط للإظهار", "Votre calque est masqué — cliquer pour afficher", "Tu capa está oculta — pulsa para mostrar", "Ваш слой скрыт — нажмите, чтобы показать", "Deine Ebene ist ausgeblendet — zum Anzeigen klicken"],
  ["שכבת הלומד", "Learner's layer", "طبقة الدارس", "Calque de l'étudiant", "Capa del estudiante", "Слой учащегося", "Ebene des Lernenden"],

  /* ── חשבון ענן ── */
  ["חשבון ענן — כניסה", "Cloud account — sign in", "حساب سحابي — تسجيل الدخول", "Compte cloud — connexion", "Cuenta en la nube — iniciar sesión", "Облачный аккаунт — вход", "Cloud-Konto — Anmeldung"],
  ["חשבון ענן", "Cloud account", "حساب سحابي", "Compte cloud", "Cuenta en la nube", "Облачный аккаунт", "Cloud-Konto"],
  ["☁ חשבון ענן", "☁ Cloud account", "☁ حساب سحابي", "☁ Compte cloud", "☁ Cuenta en la nube", "☁ Облачный аккаунт", "☁ Cloud-Konto"],
  ["שומר בענן...", "Saving to the cloud...", "جارٍ الحفظ في السحابة...", "Enregistrement dans le cloud...", "Guardando en la nube...", "Сохранение в облаке...", "Wird in der Cloud gespeichert..."],
  ["⏳ שומר בענן...", "⏳ Saving to the cloud...", "⏳ جارٍ الحفظ في السحابة...", "⏳ Enregistrement dans le cloud...", "⏳ Guardando en la nube...", "⏳ Сохранение в облаке...", "⏳ Wird in der Cloud gespeichert..."],
  ["שגיאת סנכרון: ", "Sync error: ", "خطأ في المزامنة: ", "Erreur de synchronisation : ", "Error de sincronización: ", "Ошибка синхронизации: ", "Synchronisierungsfehler: "],
  ["מסונכרן לענן · ", "Synced to the cloud · ", "تمت المزامنة مع السحابة · ", "Synchronisé avec le cloud · ", "Sincronizado con la nube · ", "Синхронизировано с облаком · ", "Mit der Cloud synchronisiert · "],
  ["נכנסת כאורח:", "You entered as a guest:", "دخلت كضيف:", "Vous êtes entré en tant qu'invité :", "Has entrado como invitado:", "Вы вошли как гость:", "Du bist als Gast eingetreten:"],
  ["מחובר בתור:", "Signed in as:", "مسجّل الدخول باسم:", "Connecté en tant que :", "Sesión iniciada como:", "Вы вошли как:", "Angemeldet als:"],
  ["✅ סנכרון שוטף פעיל — כל מרקר, הערה, תוצר וציון נשמרים גם בענן.", "✅ Continuous sync is on — every highlight, note, output and score is also saved to the cloud.", "✅ المزامنة المستمرة مفعّلة — كل تظليل وملاحظة وناتج ودرجة يُحفظ في السحابة أيضًا.", "✅ Synchronisation continue active — chaque surlignage, note, production et score est aussi enregistré dans le cloud.", "✅ Sincronización continua activa — cada subrayado, nota, resultado y puntuación se guarda también en la nube.", "✅ Постоянная синхронизация включена — каждое выделение, заметка, результат и оценка сохраняются и в облаке.", "✅ Laufende Synchronisierung aktiv — jede Markierung, Notiz, jedes Ergebnis und jede Bewertung wird auch in der Cloud gespeichert."],
  ["⬇ הורד את הספרים מהענן", "⬇ Download books from the cloud", "⬇ نزّل الكتب من السحابة", "⬇ Télécharger les livres depuis le cloud", "⬇ Descargar los libros de la nube", "⬇ Скачать книги из облака", "⬇ Bücher aus der Cloud herunterladen"],
  ["למכשיר חדש, או כדי למשוך עבודה שנעשתה במקום אחר. תמיד יוצג מה עומד לרדת לפני שמחליטים.", "For a new device, or to pull work done elsewhere. You will always see what is about to download before you decide.", "لجهاز جديد، أو لجلب عمل أُنجز في مكان آخر. سيُعرض دائمًا ما سيُنزَّل قبل أن تقرّر.", "Pour un nouvel appareil, ou pour récupérer un travail fait ailleurs. Vous verrez toujours ce qui va être téléchargé avant de décider.", "Para un dispositivo nuevo, o para traer trabajo hecho en otro lugar. Siempre verás qué se va a descargar antes de decidir.", "Для нового устройства или чтобы забрать работу, сделанную в другом месте. Перед решением всегда будет показано, что именно скачается.", "Für ein neues Gerät oder um anderswo Erarbeitetes zu holen. Du siehst immer zuerst, was heruntergeladen wird, bevor du entscheidest."],
  ["⏳ מעלה...", "⏳ Uploading...", "⏳ جارٍ الرفع...", "⏳ Envoi...", "⏳ Subiendo...", "⏳ Загрузка...", "⏳ Wird hochgeladen..."],
  ["☁ העלאה מלאה מחדש", "☁ Full re-upload", "☁ إعادة رفع كاملة", "☁ Renvoi complet", "☁ Volver a subir todo", "☁ Полная повторная загрузка", "☁ Alles erneut hochladen"],
  ["לרוב אין בזה צורך — הסנכרון השוטף מטפל בהכול. בטוח להריץ שוב: מעדכן ולא מכפיל.", "Usually not needed — continuous sync takes care of everything. Safe to run again: it updates, it does not duplicate.", "غالبًا لا حاجة لذلك — المزامنة المستمرة تتكفّل بكل شيء. آمن لإعادة التشغيل: يحدّث ولا يكرّر.", "Généralement inutile — la synchronisation continue s'occupe de tout. Sans risque à relancer : met à jour sans dupliquer.", "Normalmente no hace falta — la sincronización continua se encarga de todo. Es seguro repetirlo: actualiza, no duplica.", "Обычно в этом нет нужды — постоянная синхронизация делает всё сама. Запускать повторно безопасно: данные обновляются, а не дублируются.", "Meist nicht nötig — die laufende Synchronisierung erledigt alles. Gefahrlos wiederholbar: Es wird aktualisiert, nicht verdoppelt."],
  ["התנתק", "Sign out", "تسجيل الخروج", "Se déconnecter", "Cerrar sesión", "Выйти", "Abmelden"],
  ["כניסה בלי סיסמה: כתוב את המייל שלך ונשלח אליו קישור כניסה.", "Sign in without a password: enter your email and we will send you a sign-in link.", "دخول بلا كلمة مرور: اكتب بريدك الإلكتروني وسنرسل إليه رابط الدخول.", "Connexion sans mot de passe : saisissez votre e-mail et nous vous enverrons un lien de connexion.", "Acceso sin contraseña: escribe tu correo y te enviaremos un enlace de acceso.", "Вход без пароля: укажите свою почту, и мы пришлём на неё ссылку для входа.", "Anmeldung ohne Passwort: Gib deine E-Mail-Adresse ein, und wir schicken dir einen Anmeldelink."],
  ["📨 שלח לי קישור כניסה", "📨 Send me a sign-in link", "📨 أرسل لي رابط الدخول", "📨 Envoyez-moi un lien de connexion", "📨 Envíame un enlace de acceso", "📨 Пришлите мне ссылку для входа", "📨 Anmeldelink senden"],
  ["המשך בלי חשבון", "Continue without an account", "المتابعة بلا حساب", "Continuer sans compte", "Continuar sin cuenta", "Продолжить без аккаунта", "Ohne Konto fortfahren"],
  ["קוד מהמייל · 6 ספרות", "Code from the email · 6 digits", "الرمز من البريد · 6 أرقام", "Code reçu par e-mail · 6 chiffres", "Código del correo · 6 dígitos", "Код из письма · 6 цифр", "Code aus der E-Mail · 6 Ziffern"],
  ["🔑 כניסה עם הקוד", "🔑 Sign in with the code", "🔑 الدخول بالرمز", "🔑 Se connecter avec le code", "🔑 Entrar con el código", "🔑 Войти по коду", "🔑 Mit dem Code anmelden"],
  ["רגע — אפשר לבקש קישור חדש רק פעם בדקה. המייל הקודם שנשלח עדיין בתוקף.", "One moment — a new link can be requested only once a minute. The previous email is still valid.", "لحظة — يمكن طلب رابط جديد مرة واحدة في الدقيقة فقط. البريد السابق ما زال صالحًا.", "Un instant — un nouveau lien ne peut être demandé qu'une fois par minute. L'e-mail précédent reste valable.", "Un momento — solo se puede pedir un enlace nuevo una vez por minuto. El correo anterior sigue siendo válido.", "Минутку — новую ссылку можно запросить только раз в минуту. Предыдущее письмо ещё действительно.", "Einen Moment — ein neuer Link kann nur einmal pro Minute angefordert werden. Die vorige E-Mail ist noch gültig."],
  ["כתובת המייל לא תקינה — לבדוק שאין תו מיותר בסוף.", "The email address is not valid — check for an extra character at the end.", "عنوان البريد غير صالح — تحقّق من عدم وجود حرف زائد في النهاية.", "Adresse e-mail invalide — vérifiez qu'il n'y a pas de caractère en trop à la fin.", "La dirección de correo no es válida — comprueba que no sobre un carácter al final.", "Адрес почты указан неверно — проверьте, нет ли лишнего символа в конце.", "Die E-Mail-Adresse ist ungültig — prüfe, ob am Ende ein Zeichen zu viel steht."],
  ["כתובת מייל לא תקינה", "Invalid email address", "عنوان بريد غير صالح", "Adresse e-mail invalide", "Dirección de correo no válida", "Неверный адрес почты", "Ungültige E-Mail-Adresse"],
  ["שגיאת כניסה: ", "Sign-in error: ", "خطأ في الدخول: ", "Erreur de connexion : ", "Error de acceso: ", "Ошибка входа: ", "Anmeldefehler: "],
  ["✅ מחובר!", "✅ Signed in!", "✅ تم الدخول!", "✅ Connecté !", "✅ ¡Sesión iniciada!", "✅ Вход выполнен!", "✅ Angemeldet!"],
  ["שולח קישור...", "Sending link...", "جارٍ إرسال الرابط...", "Envoi du lien...", "Enviando enlace...", "Отправка ссылки...", "Link wird gesendet..."],
  ["✅ נשלח! פתח את המייל בטלפון ולחץ על הקישור — האפליקציה תיפתח מחוברת. (אם יש במייל קוד — אפשר גם להזין אותו כאן)", "✅ Sent! Open the email on your phone and tap the link — the app will open signed in. (If the email has a code, you can also enter it here.)", "✅ أُرسل! افتح البريد على هاتفك واضغط على الرابط — سيُفتح التطبيق وأنت مسجّل الدخول. (إن كان في البريد رمز يمكنك إدخاله هنا أيضًا)", "✅ Envoyé ! Ouvrez l'e-mail sur votre téléphone et touchez le lien — l'application s'ouvrira connectée. (Si l'e-mail contient un code, vous pouvez aussi le saisir ici.)", "✅ ¡Enviado! Abre el correo en tu teléfono y pulsa el enlace — la app se abrirá con la sesión iniciada. (Si el correo trae un código, también puedes escribirlo aquí.)", "✅ Отправлено! Откройте письмо на телефоне и нажмите на ссылку — приложение откроется уже со входом. (Если в письме есть код, его можно ввести и здесь.)", "✅ Gesendet! Öffne die E-Mail auf deinem Telefon und tippe auf den Link — die App öffnet sich angemeldet. (Enthält die E-Mail einen Code, kannst du ihn auch hier eingeben.)"],
  ["✅ נשלח! פתח את המייל שלך ולחץ על הקישור — תחזור לכאן מחובר.", "✅ Sent! Open your email and click the link — you will come back here signed in.", "✅ أُرسل! افتح بريدك واضغط على الرابط — ستعود إلى هنا مسجّل الدخول.", "✅ Envoyé ! Ouvrez votre e-mail et cliquez sur le lien — vous reviendrez ici connecté.", "✅ ¡Enviado! Abre tu correo y pulsa el enlace — volverás aquí con la sesión iniciada.", "✅ Отправлено! Откройте почту и нажмите на ссылку — вы вернётесь сюда уже со входом.", "✅ Gesendet! Öffne deine E-Mail und klicke auf den Link — du kommst angemeldet hierher zurück."],
  ["הזן את המייל ואת הקוד בן 6 הספרות מהמייל", "Enter your email and the 6-digit code from the email", "أدخل البريد والرمز المكوّن من 6 أرقام", "Saisissez votre e-mail et le code à 6 chiffres reçu", "Introduce el correo y el código de 6 dígitos", "Введите почту и 6-значный код из письма", "Gib deine E-Mail-Adresse und den 6-stelligen Code aus der E-Mail ein"],
  ["בודק קוד...", "Checking code...", "جارٍ التحقق من الرمز...", "Vérification du code...", "Comprobando código...", "Проверка кода...", "Code wird geprüft..."],
  ["הקוד לא התקבל: ", "The code was not accepted: ", "لم يُقبل الرمز: ", "Code refusé : ", "Código no aceptado: ", "Код не принят: ", "Der Code wurde nicht angenommen: "],
  ["קורא את הספרייה המקומית...", "Reading the local library...", "جارٍ قراءة المكتبة المحلية...", "Lecture de la bibliothèque locale...", "Leyendo la biblioteca local...", "Чтение локальной библиотеки...", "Lokale Bibliothek wird gelesen..."],
  ["אין ספרים מקומיים להעלאה.", "No local books to upload.", "لا توجد كتب محلية للرفع.", "Aucun livre local à envoyer.", "No hay libros locales que subir.", "Нет локальных книг для загрузки.", "Keine lokalen Bücher zum Hochladen."],
  ["מעלה ספר ", "Uploading book ", "جارٍ رفع الكتاب ", "Envoi du livre ", "Subiendo libro ", "Загружается книга ", "Buch wird hochgeladen "],
  ["✅ ההעלאה הושלמה! ", "✅ Upload complete! ", "✅ اكتمل الرفع! ", "✅ Envoi terminé ! ", "✅ ¡Subida completa! ", "✅ Загрузка завершена! ", "✅ Hochladen abgeschlossen! "],
  [" ספרים · ", " books · ", " كتب · ", " livres · ", " libros · ", " книг · ", " Bücher · "],
  [" תוצרים · ", " outputs · ", " نواتج · ", " productions · ", " resultados · ", " результатов · ", " Ergebnisse · "],
  [" הערות — שמורים בענן.", " notes — saved in the cloud.", " ملاحظات — محفوظة في السحابة.", " notes — enregistrés dans le cloud.", " notas — guardados en la nube.", " заметок — сохранено в облаке.", " Notizen — in der Cloud gespeichert."],
  ["שגיאה בהעלאה: ", "Upload error: ", "خطأ في الرفع: ", "Erreur d'envoi : ", "Error al subir: ", "Ошибка загрузки: ", "Fehler beim Hochladen: "],
  ["בודק מה יש בענן...", "Checking what is in the cloud...", "جارٍ فحص ما في السحابة...", "Vérification du contenu du cloud...", "Comprobando qué hay en la nube...", "Проверка содержимого облака...", "Cloud-Inhalt wird geprüft..."],
  ["אין ספרים בענן עדיין.", "No books in the cloud yet.", "لا توجد كتب في السحابة بعد.", "Pas encore de livres dans le cloud.", "Aún no hay libros en la nube.", "В облаке пока нет книг.", "Noch keine Bücher in der Cloud."],
  ["⬇ יש חדש בענן", "⬇ Something new in the cloud", "⬇ جديد في السحابة", "⬇ Du nouveau dans le cloud", "⬇ Hay novedades en la nube", "⬇ В облаке есть новое", "⬇ Neues in der Cloud"],
  ["הספרים הבאים נמצאים בענן. ההורדה תחליף את העותק שבמכשיר הזה:", "These books are in the cloud. Downloading will replace the copy on this device:", "الكتب التالية موجودة في السحابة. التنزيل سيستبدل النسخة الموجودة على هذا الجهاز:", "Ces livres sont dans le cloud. Le téléchargement remplacera la copie de cet appareil :", "Estos libros están en la nube. La descarga sustituirá la copia de este dispositivo:", "Эти книги находятся в облаке. Скачивание заменит копию на этом устройстве:", "Diese Bücher liegen in der Cloud. Der Download ersetzt die Kopie auf diesem Gerät:"],
  ["הספרים הבאים עודכנו במקום אחר, או שאינם קיימים במכשיר הזה:", "These books were updated elsewhere, or do not exist on this device:", "الكتب التالية حُدّثت في مكان آخر، أو غير موجودة على هذا الجهاز:", "Ces livres ont été mis à jour ailleurs, ou n'existent pas sur cet appareil :", "Estos libros se actualizaron en otro lugar, o no existen en este dispositivo:", "Эти книги были обновлены в другом месте или отсутствуют на этом устройстве:", "Diese Bücher wurden anderswo aktualisiert oder fehlen auf diesem Gerät:"],
  ["⏳ מוריד...", "⏳ Downloading...", "⏳ جارٍ التنزيل...", "⏳ Téléchargement...", "⏳ Descargando...", "⏳ Скачивание...", "⏳ Wird heruntergeladen..."],
  ["⬇ הורד הכול", "⬇ Download all", "⬇ نزّل الكل", "⬇ Tout télécharger", "⬇ Descargar todo", "⬇ Скачать всё", "⬇ Alles herunterladen"],
  ["\"לא עכשיו\" בטוח לחלוטין — שום דבר לא נמחק, וההצעה תחזור בכניסה הבאה.", "\"Not now\" is completely safe — nothing is deleted, and the offer will return next time.", "«ليس الآن» آمن تمامًا — لا يُحذف شيء، وسيعود العرض في المرة القادمة.", "« Pas maintenant » est sans aucun risque — rien n'est supprimé, et la proposition reviendra la prochaine fois.", "«Ahora no» es totalmente seguro — no se borra nada, y la propuesta volverá la próxima vez.", "«Не сейчас» совершенно безопасно — ничего не удаляется, а предложение появится снова при следующем входе.", "„Nicht jetzt“ ist völlig gefahrlos — nichts wird gelöscht, und das Angebot erscheint beim nächsten Mal wieder."],

  /* ── כניסת אורח ── */
  ["🕯 הזמינו אותך ללמוד יחד", "🕯 You have been invited to learn together", "🕯 دُعيت للتعلّم معًا", "🕯 Vous êtes invité à étudier ensemble", "🕯 Te han invitado a estudiar juntos", "🕯 Вас пригласили учиться вместе", "🕯 Du wurdest zum gemeinsamen Lernen eingeladen"],
  ["איך קוראים לך? כך החבר יראה אותך בדף.", "What is your name? This is how your partner will see you on the page.", "ما اسمك؟ هكذا سيراك شريكك في الصفحة.", "Comment vous appelez-vous ? C'est ainsi que votre partenaire vous verra sur la page.", "¿Cómo te llamas? Así te verá tu compañero en la página.", "Как вас зовут? Так напарник увидит вас на странице.", "Wie heißt du? So sieht dich dein Lernpartner auf der Seite."],
  ["השם שלך", "Your name", "اسمك", "Votre nom", "Tu nombre", "Ваше имя", "Dein Name"],
  ["נכנס…", "Entering…", "جارٍ الدخول…", "Entrée…", "Entrando…", "Вход…", "Eintritt…"],
  ["🚪 היכנס לדף", "🚪 Enter the page", "🚪 ادخل إلى الصفحة", "🚪 Entrer dans la page", "🚪 Entrar en la página", "🚪 Войти на страницу", "🚪 Seite betreten"],
  ["יש לי חשבון — כניסה במייל", "I have an account — sign in by email", "لدي حساب — الدخول بالبريد", "J'ai un compte — connexion par e-mail", "Tengo cuenta — entrar con correo", "У меня есть аккаунт — войти по почте", "Ich habe ein Konto — per E-Mail anmelden"],
  ["כאורח לא נשמר לך דבר לפעם הבאה. כניסה במייל שומרת את הסימונים וההערות.", "As a guest nothing is kept for next time. Signing in by email saves your highlights and notes.", "كضيف لا يُحفظ لك شيء للمرة القادمة. الدخول بالبريد يحفظ التظليلات والملاحظات.", "En tant qu'invité, rien n'est conservé pour la prochaine fois. La connexion par e-mail enregistre vos surlignages et vos notes.", "Como invitado no se guarda nada para la próxima vez. Entrar con correo guarda tus subrayados y notas.", "Для гостя ничего не сохраняется до следующего раза. Вход по почте сохраняет ваши выделения и заметки.", "Als Gast wird nichts fürs nächste Mal gespeichert. Die Anmeldung per E-Mail speichert deine Markierungen und Notizen."],
  ["לכתוב שם — כך החבר יראה אותך.", "Please enter a name — this is how your partner will see you.", "اكتب اسمًا — هكذا سيراك شريكك.", "Saisissez un nom — c'est ainsi que votre partenaire vous verra.", "Escribe un nombre — así te verá tu compañero.", "Введите имя — так напарник увидит вас.", "Bitte gib einen Namen ein — so sieht dich dein Lernpartner."],
  ["כניסת אורח לא זמינה כרגע — אפשר להיכנס במייל (למטה).", "Guest entry is unavailable right now — you can sign in by email (below).", "دخول الضيف غير متاح الآن — يمكنك الدخول بالبريد (في الأسفل).", "L'entrée invité est indisponible pour le moment — vous pouvez vous connecter par e-mail (ci-dessous).", "La entrada de invitado no está disponible ahora — puedes entrar con correo (abajo).", "Гостевой вход сейчас недоступен — можно войти по почте (ниже).", "Der Gastzugang ist gerade nicht verfügbar — du kannst dich per E-Mail anmelden (unten)."],

  /* ── לימוד משותף ── */
  ["🕯 לימוד משותף", "🕯 Learning together", "🕯 تعلّم مشترك", "🕯 Étude en commun", "🕯 Estudio compartido", "🕯 Совместное изучение", "🕯 Gemeinsames Lernen"],
  ["לימוד משותף", "Learning together", "تعلّم مشترك", "Étude en commun", "Estudio compartido", "Совместное изучение", "Gemeinsames Lernen"],
  ["⚠ החיבור ללימוד המשותף נפל — החבר לא רואה אותך כרגע.", "⚠ The shared session dropped — your partner cannot see you right now.", "⚠ انقطع الاتصال بالجلسة المشتركة — شريكك لا يراك الآن.", "⚠ La session commune a été coupée — votre partenaire ne vous voit plus pour l'instant.", "⚠ La sesión compartida se cortó — tu compañero no te ve ahora.", "⚠ Связь с совместным занятием прервалась — напарник сейчас вас не видит.", "⚠ Die gemeinsame Sitzung wurde unterbrochen — dein Lernpartner sieht dich gerade nicht."],
  ["↻ הצטרף מחדש", "↻ Rejoin", "↻ انضمّ من جديد", "↻ Rejoindre", "↻ Volver a unirse", "↻ Присоединиться снова", "↻ Erneut beitreten"],
  ["סיים", "End", "إنهاء", "Terminer", "Terminar", "Завершить", "Beenden"],
  ["צא", "Leave", "خروج", "Quitter", "Salir", "Выйти", "Verlassen"],
  ["הצג את כפתורי הלימוד המשותף", "Show the shared-session buttons", "أظهر أزرار الجلسة المشتركة", "Afficher les boutons de la session commune", "Mostrar los botones de la sesión compartida", "Показать кнопки совместного занятия", "Schaltflächen der gemeinsamen Sitzung anzeigen"],
  ["מחכה לחבר…", "Waiting for a partner…", "في انتظار شريك…", "En attente d'un partenaire…", "Esperando a un compañero…", "Ожидание напарника…", "Warten auf einen Lernpartner…"],
  ["מחזיק הדף:", "Holding the page:", "ممسك الصفحة:", "Tient la page :", "Tiene la página:", "Страницу ведёт:", "Hält die Seite:"],
  ["▾ הצג", "▾ Show", "▾ إظهار", "▾ Afficher", "▾ Mostrar", "▾ Показать", "▾ Anzeigen"],
  ["▴ הסתר", "▴ Hide", "▴ إخفاء", "▴ Masquer", "▴ Ocultar", "▴ Скрыть", "▴ Ausblenden"],
  ["📖 חזרה לדף המשותף", "📖 Back to the shared page", "📖 العودة إلى الصفحة المشتركة", "📖 Retour à la page commune", "📖 Volver a la página compartida", "📖 Назад к общей странице", "📖 Zurück zur gemeinsamen Seite"],
  ["קוד ההזמנה", "Invitation code", "رمز الدعوة", "Code d'invitation", "Código de invitación", "Код приглашения", "Einladungscode"],
  ["✓ הועתק", "✓ Copied", "✓ تم النسخ", "✓ Copié", "✓ Copiado", "✓ Скопировано", "✓ Kopiert"],
  ["🔗 העתק קישור", "🔗 Copy link", "🔗 انسخ الرابط", "🔗 Copier le lien", "🔗 Copiar enlace", "🔗 Скопировать ссылку", "🔗 Link kopieren"],
  ["✋ קח את הדף", "✋ Take the page", "✋ خذ الصفحة", "✋ Prendre la page", "✋ Tomar la página", "✋ Взять страницу", "✋ Seite übernehmen"],
  ["👁 עוקב", "👁 Following", "👁 متابِع", "👁 Suivi", "👁 Siguiendo", "👁 Слежу", "👁 Folgen"],
  ["👁 חופשי", "👁 Free", "👁 حرّ", "👁 Libre", "👁 Libre", "👁 Свободно", "👁 Frei"],
  ["📹 סגור וידאו", "📹 Close video", "📹 أغلق الفيديو", "📹 Fermer la vidéo", "📹 Cerrar vídeo", "📹 Закрыть видео", "📹 Video schließen"],
  ["📹 וידאו", "📹 Video", "📹 فيديو", "📹 Vidéo", "📹 Vídeo", "📹 Видео", "📹 Video"],
  ["צמצם את החלונית לפס דק", "Collapse the panel to a thin bar", "صغّر اللوحة إلى شريط رفيع", "Réduire le panneau en une fine barre", "Reducir el panel a una barra fina", "Свернуть панель в тонкую полосу", "Leiste zu einem schmalen Balken verkleinern"],
  ["להיכנס לחשבון (☁) כדי להזמין ללימוד משותף.", "Sign in (☁) to invite someone to learn together.", "سجّل الدخول (☁) لدعوة أحد إلى التعلّم المشترك.", "Connectez-vous (☁) pour inviter quelqu'un à étudier ensemble.", "Inicia sesión (☁) para invitar a alguien a estudiar juntos.", "Войдите в аккаунт (☁), чтобы пригласить к совместному изучению.", "Melde dich an (☁), um jemanden zum gemeinsamen Lernen einzuladen."],
  ["להיכנס לחשבון (☁) כדי להצטרף ללימוד המשותף.", "Sign in (☁) to join the shared session.", "سجّل الدخول (☁) للانضمام إلى الجلسة المشتركة.", "Connectez-vous (☁) pour rejoindre la session commune.", "Inicia sesión (☁) para unirte a la sesión compartida.", "Войдите в аккаунт (☁), чтобы присоединиться к совместному занятию.", "Melde dich an (☁), um der gemeinsamen Sitzung beizutreten."],
  ["לא הצלחתי לפתוח שיעור: ", "Could not open a session: ", "تعذّر فتح جلسة: ", "Impossible d'ouvrir une session : ", "No se pudo abrir una sesión: ", "Не удалось открыть занятие: ", "Sitzung konnte nicht geöffnet werden: "],
  ["לא נמצא שיעור פתוח עם הקוד ", "No open session found with the code ", "لم يُعثر على جلسة مفتوحة بالرمز ", "Aucune session ouverte avec le code ", "No se encontró una sesión abierta con el código ", "Не найдено открытого занятия с кодом ", "Keine offene Sitzung gefunden mit dem Code "],
  [" — אולי המארח כבר סיים. לבקש ממנו קישור חדש.", " — the host may have ended it. Ask them for a new link.", " — ربما أنهاها المضيف. اطلب منه رابطًا جديدًا.", " — l'hôte l'a peut-être terminée. Demandez-lui un nouveau lien.", " — quizá el anfitrión ya terminó. Pídele un enlace nuevo.", " — возможно, ведущий уже завершил его. Попросите у него новую ссылку.", " — vielleicht hat der Gastgeber sie schon beendet. Bitte ihn um einen neuen Link."],
  ["לסיים את הלימוד המשותף? החדר ייסגר לכולם, והקישור שנשלח יפסיק לעבוד.", "End the shared session? The room will close for everyone, and the link you sent will stop working.", "إنهاء الجلسة المشتركة؟ ستُغلق الغرفة للجميع، وسيتوقف الرابط المرسَل عن العمل.", "Terminer la session commune ? La salle sera fermée pour tous, et le lien envoyé ne fonctionnera plus.", "¿Terminar la sesión compartida? La sala se cerrará para todos y el enlace enviado dejará de funcionar.", "Завершить совместное занятие? Комната закроется для всех, а отправленная ссылка перестанет работать.", "Gemeinsame Sitzung beenden? Der Raum wird für alle geschlossen, und der versendete Link funktioniert nicht mehr."],
  ["הספר של הלימוד המשותף לא נמצא במכשיר הזה.", "The book of the shared session was not found on this device.", "كتاب الجلسة المشتركة غير موجود على هذا الجهاز.", "Le livre de la session commune est introuvable sur cet appareil.", "El libro de la sesión compartida no está en este dispositivo.", "Книга совместного занятия не найдена на этом устройстве.", "Das Buch der gemeinsamen Sitzung wurde auf diesem Gerät nicht gefunden."],
  ["בוא נלמד יחד במסך הלמידה — \"{title}\". פתח את הקישור וכתוב את שמך — הדף והווידאו ייפתחו מעצמם: {url}", "Let's learn together on Lomed TV — \"{title}\". Open the link and type your name — the page and the video will open by themselves: {url}", "لنتعلّم معًا على Lomed TV — «{title}». افتح الرابط واكتب اسمك — ستُفتح الصفحة والفيديو تلقائيًا: {url}", "Étudions ensemble sur Lomed TV — « {title} ». Ouvrez le lien et saisissez votre nom — la page et la vidéo s'ouvriront toutes seules : {url}", "Estudiemos juntos en Lomed TV — «{title}». Abre el enlace y escribe tu nombre — la página y el vídeo se abrirán solos: {url}", "Давай учиться вместе в Lomed TV — «{title}». Открой ссылку и напиши своё имя — страница и видео откроются сами: {url}", "Lass uns gemeinsam auf Lomed TV lernen — „{title}“. Öffne den Link und gib deinen Namen ein — Seite und Video öffnen sich von selbst: {url}"],
  ["הקישור להזמנה:", "Invitation link:", "رابط الدعوة:", "Lien d'invitation :", "Enlace de invitación:", "Ссылка-приглашение:", "Einladungslink:"],
  ["קוד השיעור (6 תווים, מהחבר שפתח את הלימוד):", "Session code (6 characters, from the partner who opened the session):", "رمز الجلسة (6 أحرف، من الشريك الذي فتح الجلسة):", "Code de la session (6 caractères, donné par le partenaire qui l'a ouverte) :", "Código de la sesión (6 caracteres, del compañero que la abrió):", "Код занятия (6 символов, от напарника, открывшего занятие):", "Sitzungscode (6 Zeichen, vom Lernpartner, der die Sitzung geöffnet hat):"],
  ["המארח סיים את הלימוד המשותף.", "The host ended the shared session.", "أنهى المضيف الجلسة المشتركة.", "L'hôte a terminé la session commune.", "El anfitrión terminó la sesión compartida.", "Ведущий завершил совместное занятие.", "Der Gastgeber hat die gemeinsame Sitzung beendet."],
  ["הצטרפות ללימוד משותף שחבר פתח — עם הקוד שלו", "Join a shared session a partner opened — with their code", "انضمّ إلى جلسة مشتركة فتحها شريك — برمزه", "Rejoindre une session ouverte par un partenaire — avec son code", "Unirse a una sesión que abrió un compañero — con su código", "Присоединиться к занятию, которое открыл напарник, — по его коду", "Einer Sitzung beitreten, die ein Lernpartner geöffnet hat — mit seinem Code"],
  ["הצטרף עם קוד", "Join with a code", "انضمّ برمز", "Rejoindre avec un code", "Unirse con código", "Войти по коду", "Mit Code beitreten"],

  /* ── וידאו ── */
  ["הדפדפן לא קיבל רשות למצלמה/מיקרופון — הגדרות ← Chrome/Safari ← מצלמה, מיקרופון ← לאשר, ולנסות שוב.", "The browser was not allowed to use the camera/microphone — Settings → Chrome/Safari → Camera, Microphone → allow, then try again.", "لم يُسمح للمتصفح باستخدام الكاميرا/الميكروفون — الإعدادات ← Chrome/Safari ← الكاميرا، الميكروفون ← اسمح، ثم حاول مجددًا.", "Le navigateur n'a pas été autorisé à utiliser la caméra/le micro — Réglages → Chrome/Safari → Caméra, Micro → autoriser, puis réessayer.", "El navegador no tiene permiso para la cámara/el micrófono — Ajustes → Chrome/Safari → Cámara, Micrófono → permitir, y vuelve a intentarlo.", "Браузеру не разрешён доступ к камере/микрофону — Настройки → Chrome/Safari → Камера, Микрофон → разрешить и попробовать снова.", "Der Browser darf Kamera/Mikrofon nicht verwenden — Einstellungen → Chrome/Safari → Kamera, Mikrofon → erlauben und erneut versuchen."],
  ["לא נמצאו מצלמה או מיקרופון במכשיר הזה.", "No camera or microphone was found on this device.", "لم يُعثر على كاميرا أو ميكروفون في هذا الجهاز.", "Aucune caméra ni aucun micro trouvés sur cet appareil.", "No se encontró cámara ni micrófono en este dispositivo.", "На этом устройстве не найдены камера или микрофон.", "Auf diesem Gerät wurden weder Kamera noch Mikrofon gefunden."],
  ["המצלמה או המיקרופון תפוסים באפליקציה אחרת (FaceTime? זום?) — לסגור אותה ולנסות שוב.", "The camera or microphone is in use by another app (FaceTime? Zoom?) — close it and try again.", "الكاميرا أو الميكروفون مستخدَمان في تطبيق آخر (FaceTime؟ Zoom؟) — أغلقه وحاول مجددًا.", "La caméra ou le micro sont utilisés par une autre application (FaceTime ? Zoom ?) — fermez-la et réessayez.", "La cámara o el micrófono están en uso por otra app (¿FaceTime? ¿Zoom?) — ciérrala y vuelve a intentarlo.", "Камера или микрофон заняты другим приложением (FaceTime? Zoom?) — закройте его и попробуйте снова.", "Kamera oder Mikrofon werden von einer anderen App verwendet (FaceTime? Zoom?) — schließe sie und versuche es erneut."],
  ["לא הצלחתי להפעיל מצלמה/מיקרופון. לנסות שוב.", "Could not start the camera/microphone. Please try again.", "تعذّر تشغيل الكاميرا/الميكروفون. حاول مجددًا.", "Impossible d'activer la caméra/le micro. Réessayez.", "No se pudo activar la cámara/el micrófono. Inténtalo de nuevo.", "Не удалось включить камеру/микрофон. Попробуйте ещё раз.", "Kamera/Mikrofon konnten nicht gestartet werden. Bitte erneut versuchen."],
  ["שגיאה בקבלת כרטיס לחדר (", "Error getting a room ticket (", "خطأ في الحصول على تذكرة الغرفة (", "Erreur d'obtention du ticket de salle (", "Error al obtener el pase de la sala (", "Ошибка получения пропуска в комнату (", "Fehler beim Abrufen des Raumtickets ("],
  ["החיבור לחדר הווידאו נותק.", "The connection to the video room was lost.", "انقطع الاتصال بغرفة الفيديو.", "La connexion à la salle vidéo a été perdue.", "Se perdió la conexión con la sala de vídeo.", "Связь с видеокомнатой прервалась.", "Die Verbindung zum Videoraum wurde getrennt."],
  ["אין חיבור לרשת — החדר לא נפתח.", "No network connection — the room did not open.", "لا يوجد اتصال بالشبكة — لم تُفتح الغرفة.", "Pas de connexion réseau — la salle ne s'est pas ouverte.", "Sin conexión de red — la sala no se abrió.", "Нет подключения к сети — комната не открылась.", "Keine Netzwerkverbindung — der Raum wurde nicht geöffnet."],
  ["לחיצה: פתח את הווידאו · אחוז וגרור להזזה", "Click: open the video · hold and drag to move", "ضغطة: افتح الفيديو · أمسك واسحب للتحريك", "Clic : ouvrir la vidéo · maintenir et glisser pour déplacer", "Clic: abrir el vídeo · mantén y arrastra para mover", "Нажатие: открыть видео · удерживайте и перетащите, чтобы переместить", "Klick: Video öffnen · halten und ziehen zum Verschieben"],
  ["לחיצה: צמצם לפס · אחוז וגרור להזזה", "Click: collapse to a bar · hold and drag to move", "ضغطة: صغّر إلى شريط · أمسك واسحب للتحريك", "Clic : réduire en barre · maintenir et glisser pour déplacer", "Clic: reducir a una barra · mantén y arrastra para mover", "Нажатие: свернуть в полосу · удерживайте и перетащите, чтобы переместить", "Klick: zum Balken verkleinern · halten und ziehen zum Verschieben"],
  ["מתחבר לחדר…", "Connecting to the room…", "جارٍ الاتصال بالغرفة…", "Connexion à la salle…", "Conectando con la sala…", "Подключение к комнате…", "Verbindung zum Raum…"],
  ["{n} בחדר", "{n} in the room", "{n} في الغرفة", "{n} dans la salle", "{n} en la sala", "В комнате: {n}", "{n} im Raum"],
  ["פתח את הווידאו", "Open the video", "افتح الفيديو", "Ouvrir la vidéo", "Abrir el vídeo", "Открыть видео", "Video öffnen"],
  ["צמצם לפס — הקול ממשיך", "Collapse to a bar — the sound continues", "صغّر إلى شريط — الصوت يستمر", "Réduire en barre — le son continue", "Reducir a una barra — el sonido continúa", "Свернуть в полосу — звук продолжается", "Zum Balken verkleinern — der Ton läuft weiter"],
  ["▴ פתח", "▴ Open", "▴ فتح", "▴ Ouvrir", "▴ Abrir", "▴ Открыть", "▴ Öffnen"],
  ["גודל: קטן / בינוני / גדול", "Size: small / medium / large", "الحجم: صغير / متوسط / كبير", "Taille : petit / moyen / grand", "Tamaño: pequeño / mediano / grande", "Размер: маленький / средний / большой", "Größe: klein / mittel / groß"],
  ["מיקרופון", "Microphone", "الميكروفون", "Micro", "Micrófono", "Микрофон", "Mikrofon"],
  ["מצלמה", "Camera", "الكاميرا", "Caméra", "Cámara", "Камера", "Kamera"],
  ["צא מהחדר", "Leave the room", "غادر الغرفة", "Quitter la salle", "Salir de la sala", "Выйти из комнаты", "Raum verlassen"],
  ["↻ התחבר מחדש", "↻ Reconnect", "↻ أعد الاتصال", "↻ Se reconnecter", "↻ Reconectar", "↻ Подключиться снова", "↻ Neu verbinden"],
  ["🔊 הפעל שמע", "🔊 Turn on sound", "🔊 شغّل الصوت", "🔊 Activer le son", "🔊 Activar sonido", "🔊 Включить звук", "🔊 Ton einschalten"],
  ["📷🎙 הצטרף עם מצלמה ומיקרופון", "📷🎙 Join with camera and microphone", "📷🎙 انضمّ بالكاميرا والميكروفون", "📷🎙 Rejoindre avec caméra et micro", "📷🎙 Unirse con cámara y micrófono", "📷🎙 Присоединиться с камерой и микрофоном", "📷🎙 Mit Kamera und Mikrofon beitreten"],
  ["אתה צופה בלבד — החבר עוד לא רואה ולא שומע אותך.", "You are only watching — your partner cannot see or hear you yet.", "أنت تشاهد فقط — شريكك لا يراك ولا يسمعك بعد.", "Vous regardez seulement — votre partenaire ne vous voit ni ne vous entend encore.", "Solo estás mirando — tu compañero aún no te ve ni te oye.", "Вы только смотрите — напарник пока не видит и не слышит вас.", "Du schaust nur zu — dein Lernpartner sieht und hört dich noch nicht."],
  ["מחכים שהחבר יפתח 📹 וידאו…", "Waiting for your partner to open 📹 video…", "في انتظار أن يفتح شريكك 📹 الفيديو…", "En attente que votre partenaire ouvre la 📹 vidéo…", "Esperando a que tu compañero abra el 📹 vídeo…", "Ждём, когда напарник включит 📹 видео…", "Warten, bis dein Lernpartner das 📹 Video öffnet…"],

  /* ── ספרייה ── */
  ["טוען את הספרייה…", "Loading the library…", "جارٍ تحميل المكتبة…", "Chargement de la bibliothèque…", "Cargando la biblioteca…", "Загрузка библиотеки…", "Bibliothek wird geladen…"],
  ["הספרים שלך. כל ספר שומר את הפרקים, התוצרים והציונים שלו.", "Your books. Each book keeps its chapters, outputs and scores.", "كتبك. كل كتاب يحفظ فصوله ونواتجه ودرجاته.", "Vos livres. Chaque livre conserve ses chapitres, ses productions et ses scores.", "Tus libros. Cada libro guarda sus capítulos, resultados y puntuaciones.", "Ваши книги. Каждая книга хранит свои главы, результаты и оценки.", "Deine Bücher. Jedes Buch behält seine Kapitel, Ergebnisse und Bewertungen."],
  ["השאלה שאתה נושא איתך", "The question you carry with you", "السؤال الذي تحمله معك", "La question que vous portez", "La pregunta que llevas contigo", "Вопрос, с которым вы пришли", "Die Frage, die du mitbringst"],
  ["להסיר את השאלה", "Remove the question", "إزالة السؤال", "Retirer la question", "Quitar la pregunta", "Убрать вопрос", "Frage entfernen"],
  ["● מקליט… לסיום לחץ ⏹ למטה", "● Recording… press ⏹ below to finish", "● جارٍ التسجيل… للإنهاء اضغط ⏹ في الأسفل", "● Enregistrement… appuyez sur ⏹ en bas pour terminer", "● Grabando… pulsa ⏹ abajo para terminar", "● Идёт запись… чтобы закончить, нажмите ⏹ внизу", "● Aufnahme läuft… zum Beenden unten ⏹ drücken"],
  ["{a}/{b} פרקים הושלמו", "{a}/{b} chapters completed", "{a}/{b} فصول مكتملة", "{a}/{b} chapitres terminés", "{a}/{b} capítulos completados", "Пройдено глав: {a}/{b}", "{a}/{b} Kapitel abgeschlossen"],
  ["🎧 שיקוף — {n} הערות וסימונים בספר הזה", "🎧 Reflection — {n} notes and highlights in this book", "🎧 انعكاس — {n} ملاحظات وتظليلات في هذا الكتاب", "🎧 Reflet — {n} notes et surlignages dans ce livre", "🎧 Reflejo — {n} notas y subrayados en este libro", "🎧 Отражение — заметок и выделений в этой книге: {n}", "🎧 Spiegelung — {n} Notizen und Markierungen in diesem Buch"],
  ["שיקוף", "Reflection", "انعكاس", "Reflet", "Reflejo", "Отражение", "Spiegelung"],
  ["מחק ספר", "Delete book", "حذف الكتاب", "Supprimer le livre", "Eliminar libro", "Удалить книгу", "Buch löschen"],
  ["ספר חדש", "New book", "كتاب جديد", "Nouveau livre", "Libro nuevo", "Новая книга", "Neues Buch"],
  ["עצור", "Stop", "إيقاف", "Arrêter", "Detener", "Стоп", "Stopp"],
  ["אודיו/וידאו", "Audio/video", "صوت/فيديو", "Audio/vidéo", "Audio/vídeo", "Аудио/видео", "Audio/Video"],
  ["ארון הספרים — 70 ספרי מקור, לייבוא ללימוד", "Bookshelf — 70 source books, to import for study", "خزانة الكتب — 70 كتابًا مصدريًا، للاستيراد للدراسة", "Étagère — 70 livres sources, à importer pour l'étude", "Estantería — 70 libros fuente, para importar y estudiar", "Книжный шкаф — 70 книг-первоисточников для импорта и изучения", "Bücherschrank — 70 Quellenwerke zum Importieren und Lernen"],
  ["ארון הספרים", "Bookshelf", "خزانة الكتب", "Étagère", "Estantería", "Книжный шкаф", "Bücherschrank"],
  ["כל הספרים", "All books", "كل الكتب", "Tous les livres", "Todos los libros", "Все книги", "Alle Bücher"],
  ["פותח את הארון בלשונית חדשה", "Opens the bookshelf in a new tab", "يفتح الخزانة في تبويب جديد", "Ouvre l'étagère dans un nouvel onglet", "Abre la estantería en una pestaña nueva", "Открывает шкаф в новой вкладке", "Öffnet den Bücherschrank in einem neuen Tab"],
  ["פתח את הארון", "Open the bookshelf", "افتح الخزانة", "Ouvrir l'étagère", "Abrir la estantería", "Открыть шкаф", "Bücherschrank öffnen"],
  ["חזרה לספרייה", "Back to the library", "العودة إلى المكتبة", "Retour à la bibliothèque", "Volver a la biblioteca", "Назад в библиотеку", "Zurück zur Bibliothek"],

  /* ── ספר חדש ── */
  ["הדבק ספר, פרק או מאמר — או העלה קובץ — והמסך יהפוך אותו לסדרת פרקים עם ערוצי למידה: סיכום, מושגים, מפת חשיבה, מבחן ועוד. ההתקדמות נשמרת, כך שאפשר ללמוד ספר שלם לאורך זמן.", "Paste a book, a chapter or an article — or upload a file — and the screen will turn it into a series of chapters with learning channels: summary, concepts, mind map, quiz and more. Your progress is saved, so you can study a whole book over time.", "الصق كتابًا أو فصلًا أو مقالًا — أو ارفع ملفًا — وستحوّله الشاشة إلى سلسلة فصول مع قنوات تعلّم: ملخّص، مفاهيم، خريطة ذهنية، اختبار وغير ذلك. تقدّمك محفوظ، فيمكنك دراسة كتاب كامل على مدى الزمن.", "Collez un livre, un chapitre ou un article — ou envoyez un fichier — et l'écran en fera une série de chapitres avec des chaînes d'étude : résumé, concepts, carte mentale, quiz et plus encore. Votre progression est enregistrée : vous pouvez étudier un livre entier au fil du temps.", "Pega un libro, un capítulo o un artículo — o sube un archivo — y la pantalla lo convertirá en una serie de capítulos con canales de estudio: resumen, conceptos, mapa mental, examen y más. Tu progreso se guarda, así que puedes estudiar un libro entero con el tiempo.", "Вставьте книгу, главу или статью — или загрузите файл — и экран превратит их в серию глав с каналами изучения: конспект, понятия, карта мыслей, тест и другое. Прогресс сохраняется, так что целую книгу можно изучать постепенно.", "Füge ein Buch, ein Kapitel oder einen Artikel ein — oder lade eine Datei hoch — und der Bildschirm macht daraus eine Reihe von Kapiteln mit Lernkanälen: Zusammenfassung, Begriffe, Mindmap, Quiz und mehr. Dein Fortschritt wird gespeichert, sodass du ein ganzes Buch über längere Zeit lernen kannst."],
  ["שם הספר (למשל: אדיר במרום — הרמח״ל)", "Book title", "عنوان الكتاب", "Titre du livre", "Título del libro", "Название книги", "Buchtitel"],
  ["⬇ הכפתורים למטה: שדר טקסט, העלה קבצים (אפשר כמה בבת אחת — כל קובץ נהיה ספר), צילומים לפענוח OCR עברי, או 🎬 שיעור מוקלט — קובץ אודיו או וידאו שמתומלל לטקסט עברי והופך לספר.", "⬇ The buttons below: broadcast the text, upload files (several at once — each file becomes a book), photos for text recognition (OCR), or 🎬 a recorded lesson — an audio or video file that is transcribed and becomes a book.", "⬇ الأزرار في الأسفل: بثّ النص، ارفع ملفات (عدة ملفات معًا — كل ملف يصبح كتابًا)، صور للتعرّف على النص (OCR)، أو 🎬 درس مسجّل — ملف صوت أو فيديو يُفرَّغ نصًا ويصبح كتابًا.", "⬇ Les boutons ci-dessous : diffuser le texte, envoyer des fichiers (plusieurs à la fois — chaque fichier devient un livre), des photos pour la reconnaissance de texte (OCR), ou 🎬 un cours enregistré — un fichier audio ou vidéo transcrit qui devient un livre.", "⬇ Los botones de abajo: emitir el texto, subir archivos (varios a la vez — cada archivo se vuelve un libro), fotos para reconocimiento de texto (OCR), o 🎬 una clase grabada — un archivo de audio o vídeo que se transcribe y se convierte en libro.", "⬇ Кнопки внизу: отправить текст, загрузить файлы (можно несколько сразу — каждый файл станет книгой), фотографии для распознавания текста (OCR) или 🎬 записанный урок — аудио- или видеофайл, который расшифровывается и становится книгой.", "⬇ Die Schaltflächen unten: Text senden, Dateien hochladen (mehrere auf einmal — jede Datei wird ein Buch), Fotos zur Texterkennung (OCR) oder 🎬 eine aufgezeichnete Lektion — eine Audio- oder Videodatei, die transkribiert und zum Buch wird."],
  ["📸 צלם דף חכם (AI · לדפי זוהר ודפים מפורשים) — תבנית:", "📸 Smart page scan (AI · for annotated pages) — layout:", "📸 مسح ذكي للصفحة (ذكاء اصطناعي · للصفحات المشروحة) — القالب:", "📸 Scan intelligent de page (IA · pour pages annotées) — gabarit :", "📸 Escaneo inteligente de página (IA · para páginas comentadas) — plantilla:", "📸 Умное сканирование страницы (ИИ · для страниц с комментариями) — шаблон:", "📸 Intelligenter Seitenscan (KI · für kommentierte Seiten) — Vorlage:"],
  ["📷 צלם עכשיו", "📷 Take a photo now", "📷 صوّر الآن", "📷 Photographier maintenant", "📷 Fotografiar ahora", "📷 Сфотографировать сейчас", "📷 Jetzt fotografieren"],
  ["🎙 הקלט שיעור חי", "🎙 Record a live lesson", "🎙 سجّل درسًا مباشرًا", "🎙 Enregistrer un cours en direct", "🎙 Grabar una clase en vivo", "🎙 Записать живой урок", "🎙 Live-Lektion aufnehmen"],
  ["● מקליט…", "● Recording…", "● جارٍ التسجيل…", "● Enregistrement…", "● Grabando…", "● Идёт запись…", "● Aufnahme läuft…"],
  ["⏹ עצור וסיים", "⏹ Stop and finish", "⏹ أوقف وأنهِ", "⏹ Arrêter et terminer", "⏹ Detener y terminar", "⏹ Остановить и закончить", "⏹ Stoppen und beenden"],
  ["🎥 צלם וידאו", "🎥 Record video", "🎥 صوّر فيديو", "🎥 Filmer une vidéo", "🎥 Grabar vídeo", "🎥 Снять видео", "🎥 Video aufnehmen"],
  ["שיעור, הרצאה או הקראה — בסיום ההקלטה מתומללת והופכת לספר", "A lesson, a lecture or a reading — when you finish, the recording is transcribed and becomes a book", "درس أو محاضرة أو قراءة — عند الانتهاء يُفرَّغ التسجيل نصًا ويصبح كتابًا", "Un cours, une conférence ou une lecture — à la fin, l'enregistrement est transcrit et devient un livre", "Una clase, una conferencia o una lectura — al terminar, la grabación se transcribe y se convierte en libro", "Урок, лекция или чтение вслух — по окончании запись расшифровывается и становится книгой", "Eine Lektion, ein Vortrag oder eine Lesung — am Ende wird die Aufnahme transkribiert und zum Buch"],
  ["או הדבק טקסט", "or paste text", "أو الصق نصًا", "ou collez un texte", "o pega un texto", "или вставьте текст", "oder Text einfügen"],
  ["הדבק את הטקסט כאן...", "Paste the text here...", "الصق النص هنا...", "Collez le texte ici...", "Pega el texto aquí...", "Вставьте текст сюда...", "Text hier einfügen..."],
  ["טקסט ארוך יחולק אוטומטית לפרקים. לחלוקה ידנית — שורה של === בין הקטעים.", "A long text is split into chapters automatically. To split it yourself — put a line of === between sections.", "النص الطويل يُقسَّم تلقائيًا إلى فصول. للتقسيم اليدوي — ضع سطرًا من === بين المقاطع.", "Un texte long est découpé automatiquement en chapitres. Pour découper vous-même — une ligne de === entre les sections.", "Un texto largo se divide automáticamente en capítulos. Para dividirlo a mano — una línea de === entre las secciones.", "Длинный текст автоматически делится на главы. Чтобы разделить вручную — поставьте строку === между частями.", "Ein langer Text wird automatisch in Kapitel geteilt. Zum manuellen Teilen — eine Zeile mit === zwischen die Abschnitte setzen."],
  ["שדר טקסט", "Broadcast text", "بثّ النص", "Diffuser le texte", "Emitir texto", "Отправить текст", "Text senden"],
  ["קבצים", "Files", "ملفات", "Fichiers", "Archivos", "Файлы", "Dateien"],
  ["צילומים OCR", "Photos (OCR)", "صور (OCR)", "Photos (OCR)", "Fotos (OCR)", "Фото (OCR)", "Fotos (OCR)"],
  ["דף חכם AI", "Smart page (AI)", "صفحة ذكية (AI)", "Page intelligente (IA)", "Página inteligente (IA)", "Умная страница (ИИ)", "Intelligente Seite (KI)"],
  ["שיעור מוקלט", "Recorded lesson", "درس مسجّل", "Cours enregistré", "Clase grabada", "Записанный урок", "Aufgezeichnete Lektion"],
  /* ── הערוצים וערוץ התרגום ── */
  ["טקסט הפרק", "Chapter text", "نص الفصل", "Texte du chapitre", "Texto del capítulo", "Текст главы", "Kapiteltext"],
  ["סיכום", "Summary", "ملخّص", "Résumé", "Resumen", "Конспект", "Zusammenfassung"],
  ["מושגים וכללים", "Concepts and rules", "مفاهيم وقواعد", "Concepts et règles", "Conceptos y reglas", "Понятия и правила", "Begriffe und Regeln"],
  ["מפת חשיבה", "Mind map", "خريطة ذهنية", "Carte mentale", "Mapa mental", "Карта мыслей", "Mindmap"],
  ["תרשים זרימה", "Flow chart", "مخطط انسيابي", "Diagramme de flux", "Diagrama de flujo", "Блок-схема", "Flussdiagramm"],
  ["מבחן", "Quiz", "اختبار", "Quiz", "Examen", "Тест", "Quiz"],
  ["כרטיסיות", "Flashcards", "بطاقات", "Cartes mémoire", "Tarjetas", "Карточки", "Karteikarten"],
  ["הקראה", "Read aloud", "قراءة بصوت", "Lecture à voix haute", "Lectura en voz alta", "Чтение вслух", "Vorlesen"],
  ["תרגום", "Translation", "ترجمة", "Traduction", "Traducción", "Перевод", "Übersetzung"],
  ["תרגום ל:", "Translate into:", "ترجم إلى:", "Traduire en :", "Traducir a:", "Перевести на:", "Übersetzen in:"],
  ["התרגום נוצר במכונה ונשמר עם הספר. המקור הוא הקובע.", "This translation was made by a machine and is saved with the book. The original is the authoritative text.", "هذه الترجمة آلية ومحفوظة مع الكتاب. النص الأصلي هو المرجع.", "Cette traduction est automatique et enregistrée avec le livre. L'original fait foi.", "Esta traducción es automática y se guarda con el libro. El original es el texto de referencia.", "Перевод выполнен машиной и сохранён вместе с книгой. Определяющим остаётся оригинал.", "Diese Übersetzung wurde maschinell erstellt und mit dem Buch gespeichert. Maßgeblich ist das Original."],
  ["התרגום חזר לא שלם — נסה שוב.", "The translation came back incomplete — please try again.", "عادت الترجمة ناقصة — حاول مجددًا.", "La traduction est revenue incomplète — réessayez.", "La traducción llegó incompleta — inténtalo de nuevo.", "Перевод вернулся неполным — попробуйте ещё раз.", "Die Übersetzung kam unvollständig zurück — bitte erneut versuchen."],
  ["התרגום נכשל. נסה שוב.", "The translation failed. Please try again.", "فشلت الترجمة. حاول مجددًا.", "La traduction a échoué. Réessayez.", "La traducción falló. Inténtalo de nuevo.", "Не удалось перевести. Попробуйте ещё раз.", "Die Übersetzung ist fehlgeschlagen. Bitte erneut versuchen."],
  ["הספר לא נמצא באחסון.", "The book was not found in this device's storage.", "الكتاب غير موجود في تخزين هذا الجهاز.", "Le livre est introuvable dans le stockage de cet appareil.", "El libro no se encontró en el almacenamiento de este dispositivo.", "Книга не найдена в хранилище этого устройства.", "Das Buch wurde im Speicher dieses Geräts nicht gefunden."],
];

const STR = {};
for (let c = 1; c < COLS.length; c++) {
  const m = {};
  for (const row of T) if (row[c]) m[row[0]] = row[c];
  STR[COLS[c]] = m;
}

/* שפת הפתיחה: מה שנבחר ונשמר ← מי שכבר משתמש באפליקציה נשאר בעברית ← שפת המכשיר ← אנגלית */
function initialLang() {
  try {
    const saved = localStorage.getItem("lomedtv-lang");
    if (COLS.includes(saved)) return saved;
    if (localStorage.getItem("lomedtv-opened") || localStorage.getItem("ltv-books-index")) return "he";
  } catch {}
  const nav = (typeof navigator !== "undefined" && (navigator.language || "")).toLowerCase();
  if (nav.startsWith("iw")) return "he";
  const hit = COLS.find((c) => nav.startsWith(c));
  return hit || "en";
}

let LANG = initialLang();
const applyDoc = () => {
  if (typeof document === "undefined") return;
  document.documentElement.lang = LANG;
  document.documentElement.dir = langDir();
};

export const getLang = () => LANG;
export function langDir() { return (LANGS.find((l) => l[0] === LANG) || LANGS[0])[2]; }
export function setLang(l) {
  if (!COLS.includes(l)) return;
  LANG = l;
  try { localStorage.setItem("lomedtv-lang", l); } catch {}
  applyDoc();
}
/* tx("עברית", { n: 3 }) — מחזיר את התרגום לשפה הנוכחית, ומציב ערכים במקום {n} */
export function tx(s, vars) {
  let out = LANG !== "he" && STR[LANG] && STR[LANG][s] ? STR[LANG][s] : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}
applyDoc();
