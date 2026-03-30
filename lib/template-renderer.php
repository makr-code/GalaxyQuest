<?php
/**
 * Template Variable Renderer
 * 
 * Processes {{variable}} placeholders in HTML output before sending to browser.
 * 
 * Usage:
 *   ob_start();
 *   include('index.html');
 *   $html = ob_get_clean();
 *   $rendered = renderTemplate($html, ['buildnr' => '123', 'build_date' => '2026-03-30']);
 *   echo $rendered;
 */

function renderTemplate(string $html, array $variables = []): string {
  // Set default variables if not provided
  $vars = array_merge([
    'buildnr' => 'unknown',
    'build_date' => date('Y-m-d H:i:s'),
    'build_version' => getenv('BUILD_VERSION') ?: 'dev',
    'app_env' => getenv('APP_ENV') ?: 'production',
  ], $variables);

  // Replace {{variable}} placeholders with values
  foreach ($vars as $key => $value) {
    $placeholder = '{{' . preg_quote($key, '/') . '}}';
    $html = preg_replace('/' . $placeholder . '/', htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8'), $html);
  }

  return $html;
}

/**
 * Get current build information
 */
function getBuildInfo(): array {
  $buildFile = __DIR__ . '/../.build';
  $buildInfo = [
    'buildnr' => 'local-dev',
    'build_date' => date('Y-m-d'),
    'timestamp' => time(),
  ];

  if (is_file($buildFile)) {
    $content = file_get_contents($buildFile);
    $lines = array_filter(array_map('trim', explode("\n", $content)));
    foreach ($lines as $line) {
      if (str_contains($line, '=')) {
        [$key, $val] = explode('=', $line, 2);
        $buildInfo[trim($key)] = trim($val);
      }
    }
  }

  return $buildInfo;
}

?>
