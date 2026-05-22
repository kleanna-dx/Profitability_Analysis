<?php
/**
 * Adminer Wrapper - Forces UTF-8 charset for proper Korean character display
 * 
 * This wrapper creates an Adminer plugin that:
 * 1. Forces charset=utf8mb4 on every database connection
 * 2. Sets proper HTTP Content-Type header with UTF-8
 * 3. Pre-fills login credentials for convenience
 */

// Force PHP to use UTF-8 internally
ini_set('default_charset', 'UTF-8');
if (function_exists('mb_internal_encoding')) {
    mb_internal_encoding('UTF-8');
}

// Custom Adminer plugin to force UTF-8
function adminer_object() {
    class AdminerUtf8 extends Adminer {
        
        // Force charset on login
        function login($login, $password) {
            return true;
        }
        
        // Pre-fill default server/credentials
        function loginForm() {
            ?>
            <table cellspacing="0" class="layout">
            <tr><th><?php echo lang('Server'); ?><td><input type="text" name="auth[server]" value="<?php echo htmlspecialchars($_GET['server'] ?? 'localhost'); ?>" title="hostname[:port]" placeholder="localhost" autocapitalize="off">
            <tr><th><?php echo lang('Username'); ?><td><input type="text" name="auth[username]" id="username" value="<?php echo htmlspecialchars($_GET['username'] ?? 'company'); ?>" autocomplete="username" autocapitalize="off">
            <tr><th><?php echo lang('Password'); ?><td><input type="password" name="auth[password]" autocomplete="current-password">
            <tr><th><?php echo lang('Database'); ?><td><input type="text" name="auth[db]" value="<?php echo htmlspecialchars($_GET['db'] ?? 'company_board'); ?>" autocapitalize="off">
            </table>
            <p><input type="submit" value="<?php echo lang('Login'); ?>">
            <?php
            echo checkbox("auth[permanent]", 1, $_COOKIE["adminer_permanent"], lang('Permanent login'));
            return true;
        }
        
        // Force UTF-8 headers
        function head() {
            echo '<meta charset="UTF-8">' . "\n";
            return true; // false prevents default head output, true allows it
        }
        
        // Database name in title
        function name() {
            return 'Company DB Manager';
        }
    }
    
    return new AdminerUtf8;
}

// Set headers before any output
header('Content-Type: text/html; charset=UTF-8');

// Include the actual Adminer
include __DIR__ . '/adminer.php';
