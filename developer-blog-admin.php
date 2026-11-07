<?php
declare(strict_types=1);
require_once __DIR__ . '/api/helpers.php';
require_once __DIR__ . '/lib/DeveloperBlogRepository.php';
$uid = require_auth();
if (!is_admin_user(get_db(), $uid)) json_error('Admin access required.', 403);
header('Cache-Control: no-store');
if (BLOG_SOURCE !== 'local') {
    http_response_code(409);
    echo '<!doctype html><html lang="de"><meta charset="utf-8"><title>Externe Blogquelle</title>'
        . '<p>Die lokale Redaktion ist deaktiviert. Beiträge werden im führenden Blog verwaltet.</p><a href="./">Zur Startseite</a></html>';
    exit;
}
?>
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Entwicklerblog – Redaktion</title>
  <link rel="stylesheet" href="css/developer-blog.css">
</head>
<body class="blog-admin">
  <main>
    <h1>Entwicklerblog – Redaktion</h1>
    <a href="./">Zur Startseite</a>
    <p id="blog-admin-status" role="status"></p>
    <nav aria-label="Beiträge"><button id="blog-new" type="button">Neuer Beitrag</button><div id="blog-admin-posts"></div></nav>
    <nav aria-label="Seiten"><button id="blog-prev" type="button">Zurück</button><button id="blog-next" type="button">Weiter</button></nav>
    <nav aria-label="Aktualisieren"><button id="blog-reload" type="button">Beitragsliste neu laden (Text bleibt erhalten)</button></nav>
    <form id="blog-editor">
      <label>Titel<input name="title" data-max-chars="<?= DeveloperBlogRepository::MAX_TITLE_CHARS ?>" aria-describedby="blog-title-count" required></label>
      <p id="blog-title-count"></p>
      <label>Beitrag (Klartext)<textarea name="body" data-max-chars="<?= DeveloperBlogRepository::MAX_BODY_CHARS ?>" aria-describedby="blog-body-count blog-length-hint" rows="12" required></textarea></label>
      <p id="blog-body-count"></p>
      <p id="blog-speech-estimate"></p>
      <p id="blog-unsaved" role="status"></p>
      <p id="blog-length-hint">Darstellung und Sprachausgabe sind auf <?= DeveloperBlogRepository::MAX_BODY_CHARS ?> Zeichen Beitragstext begrenzt. Längere Themen bitte auf mehrere Beiträge aufteilen.</p>
      <label>Kategorien<input name="categories" value="entwicklung" maxlength="168" aria-describedby="blog-taxonomy-hint" required></label>
      <label>Tags<input name="tags" maxlength="338" aria-describedby="blog-taxonomy-hint"></label>
      <p id="blog-taxonomy-hint">Kommagetrennt: 1–5 Kategorien und bis zu 10 Tags. Je Eintrag maximal 32 Zeichen (a-z, 0-9 und Bindestrich), z. B. entwicklung, audio oder ui-ux. Der Tag hero hebt besonders wichtige Nachrichten hervor, ohne die zeitliche Reihenfolge zu ändern.</p>
      <label>Animationsziel<select name="target_faction_id"><option value="">Kein Flugziel</option></select></label>
      <label><input name="published" type="checkbox"> Veröffentlicht (deaktivieren zum Zurückziehen)</label>
      <button type="submit">Speichern</button>
    </form>
  </main>
  <script type="module" src="js/ui/developer-blog-admin.js"></script>
</body>
</html>
