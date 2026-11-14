<?php

declare(strict_types=1);

require_once __DIR__ . '/DraftWorldSimulation.php';
require_once __DIR__ . '/RegistrationDraftService.php';
require_once __DIR__ . '/RegistrationPortraitService.php';

final class RegistrationPlayService
{
    public function __construct(private PDO $db)
    {
    }

    public function status(string $owner): ?array
    {
        $row = $this->row($owner);
        return $row && $row['state_json'] !== null ? $this->publicState($row) : null;
    }

    public function enter(string $owner, string $token): array
    {
        return $this->transaction(function () use ($owner, $token): array {
            $row = $this->row($owner, true);
            if (!$row || !hash_equals($row['token'], $token)) {
                throw new RuntimeException('Selected draft is unavailable.', 410);
            }
            if ($row['state_json'] !== null) {
                return $this->publicState($row);
            }
            $draft = json_decode($row['snapshot_json'], true, 512, JSON_THROW_ON_ERROR);
            if (!isset($draft['character'], $draft['species_code'])) {
                throw new InvalidArgumentException('Save your character before entering the draft world.');
            }
            $state = DraftWorldSimulation::create($draft, time());
            $this->db->prepare('INSERT INTO registration_play (draft_token, state_json) VALUES (?, ?)')
                ->execute([$token, json_encode($state, JSON_THROW_ON_ERROR)]);
            // The reservation has no gameplay expiry; SQL DATETIME still requires a concrete value.
            $this->db->prepare(
                "UPDATE registration_drafts SET expires_at = '9999-12-31 23:59:59' WHERE token = ?"
            )->execute([$token]);
            return $this->status($owner) ?? throw new RuntimeException('Draft entry could not be persisted.', 503);
        });
    }

    public function play(string $owner, array $input): array
    {
        return $this->transaction(function () use ($owner, $input): array {
            $row = $this->requireRow($owner);
            $draft = json_decode($row['snapshot_json'], true, 512, JSON_THROW_ON_ERROR);
            $now = time();
            $state = DraftWorldSimulation::advance(
                json_decode($row['state_json'], true, 512, JSON_THROW_ON_ERROR),
                $draft,
                $now
            );
            if (($input['kind'] ?? 'settle') !== 'settle') {
                $state = DraftWorldSimulation::command($state, $draft, $input, $now);
            }
            $this->db->prepare('UPDATE registration_play SET state_json = ? WHERE draft_token = ?')
                ->execute([json_encode($state, JSON_THROW_ON_ERROR), $row['token']]);
            return $this->status($owner) ?? throw new RuntimeException('Draft progress could not be persisted.', 503);
        });
    }

    public function sendConfirmation(string $owner, array $input, Closure $deliver): array
    {
        $email = $input['email'] ?? null;
        $password = $input['password'] ?? null;
        if (
            !is_string($email) || strlen($email) > 255 || !filter_var($email, FILTER_VALIDATE_EMAIL)
            || !is_string($password) || strlen($password) < 12 || strlen($password) > 72
        ) {
            throw new InvalidArgumentException('Enter a valid email and a password of 12-72 bytes.');
        }
        $email = trim($email);
        $hash = password_hash($password, PASSWORD_BCRYPT);
        return $this->transaction(function () use ($owner, $email, $hash, $input, $deliver): array {
            $row = $this->requireRow($owner);
            if ($row['verification_sent_at'] && strtotime($row['verification_sent_at'] . ' UTC') > time() - 60) {
                throw new RuntimeException('Wait one minute before requesting another email.', 429);
            }
            $draft = json_decode($row['snapshot_json'], true, 512, JSON_THROW_ON_ERROR);
            $username = $input['username'] ?? $draft['character']['name'];
            if (!is_string($username) || !preg_match('/^[A-Za-z0-9_]{3,32}$/', $username)) {
                throw new InvalidArgumentException('Enter a login name of 3-32 letters, digits or underscores.');
            }
            $stmt = $this->db->prepare('SELECT id FROM users WHERE username = ? OR email = ?');
            $stmt->execute([$username, $email]);
            if ($stmt->fetchColumn()) {
                throw new RuntimeException('Commander name or email is already in use.', 409);
            }
            $token = bin2hex(random_bytes(32));
            $state = json_decode($row['state_json'], true, 512, JSON_THROW_ON_ERROR);
            $state['account_username'] = $username;
            $this->db->prepare(
                'UPDATE registration_play SET email = ?, password_hash = ?, verification_hash = ?,
                 verification_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 24 HOUR),
                 verification_sent_at = UTC_TIMESTAMP(), verification_attempts = 0,
                 state_json = ? WHERE draft_token = ?'
            )->execute([
                $email,
                $hash,
                hash('sha256', $token),
                json_encode($state, JSON_THROW_ON_ERROR),
                $row['token'],
            ]);
            $deliver($email, $token);
            return ['sent' => true, 'email' => $email];
        });
    }

    public function confirm(string $token): array
    {
        if (!preg_match('/^[a-f0-9]{64}$/', $token)) {
            throw new InvalidArgumentException('Invalid email confirmation link. Request another email.');
        }
        return $this->transaction(function () use ($token): array {
            $stmt = $this->db->prepare(
                'SELECT d.*, p.state_json, p.email, p.password_hash, p.verification_expires_at
                 FROM registration_drafts d JOIN registration_play p ON p.draft_token = d.token
                 WHERE p.verification_hash = ? AND d.expires_at > UTC_TIMESTAMP() FOR UPDATE'
            );
            $stmt->execute([hash('sha256', $token)]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$row || strtotime($row['verification_expires_at'] . ' UTC') <= time()) {
                throw new RuntimeException(
                    'Confirmation link invalid, expired or already used. Request another email.',
                    410
                );
            }
            $draft = json_decode($row['snapshot_json'], true, 512, JSON_THROW_ON_ERROR);
            $state = DraftWorldSimulation::advance(
                json_decode($row['state_json'], true, 512, JSON_THROW_ON_ERROR),
                $draft,
                time()
            );
            if ($state['economy']['pending_seconds'] > 0) {
                throw new RuntimeException('Refresh your offline draft progress before confirming.', 409);
            }
            return PlanetReservation::withLock(
                $this->db,
                (int)$row['planet_id'],
                function () use ($row, $draft, $state): array {
                    $username = $state['account_username'] ?? $draft['character']['name'];
                    $this->db->prepare(
                        'INSERT INTO users (username, email, password_hash, ftl_drive_type, last_login)
                     VALUES (?, ?, ?, ?, UTC_TIMESTAMP())'
                    )
                    ->execute([$username, $row['email'], $row['password_hash'], $draft['species_code']]);
                    $uid = (int)$this->db->lastInsertId();
                    $portrait = $this->db->prepare(
                        "SELECT image FROM registration_portraits
                         WHERE draft_token = ? AND identity_hash = ? AND status = 'generated'"
                    );
                    $portrait->execute([$row['token'], RegistrationPortraitService::identityHash($draft)]);
                    $image = $portrait->fetchColumn();
                    $this->db->prepare(
                        'INSERT INTO user_draft_progress (user_id, state_json, email_verified_at, portrait)
                     VALUES (?, ?, UTC_TIMESTAMP(), ?)'
                    )->execute([
                    $uid,
                    json_encode(['world' => $draft, 'progress' => $state], JSON_THROW_ON_ERROR),
                    $image === false ? null : $image,
                    ]);
                // Remove only inside the promotion transaction, while holding the planet allocation lock.
                    $this->db->prepare('DELETE FROM registration_drafts WHERE token = ?')->execute([$row['token']]);
                    $starter = $draft['starter'];
                    $starter['resources'] = array_replace($starter['resources'], $state['economy']['stock']);
                    $starter['buildings'] = $state['buildings'];
                    $starter['ships'] = $state['ships'];
                    if (isset($state['queues']['fleet'])) {
                        $starter['ships']['espionage_probe']--;
                    }
                    $starter['population']['population'] = array_sum($state['economy']['classes']);
                    $starter['population']['happiness'] = (int)round($state['economy']['satisfaction']);
                    $starter['population']['max_population'] = DraftWorldSimulation::context(
                        $state,
                        $draft
                    )['population_capacity'];
                    $cid = (new FactionHomeworldSeeder($this->db))->createColony(
                        $uid,
                        $draft['colony_name'],
                        $draft['position'],
                        $starter
                    );
                    $this->db->prepare('UPDATE users SET credits = credits + ? WHERE id = ?')
                    ->execute([$state['economy']['credit_delta'], $uid]);
                    $this->db->prepare(
                        'INSERT INTO user_onboarding (user_id, faction_id, species_code, gameplay_style)
                     VALUES (?, ?, ?, ?)'
                    )->execute([
                    $uid,
                    $row['faction_id'],
                    $draft['species_code'],
                    $draft['gameplay_style'] ?? 'exploration',
                    ]);
                    $research = $this->db->prepare('UPDATE research SET level = ? WHERE user_id = ? AND type = ?');
                    foreach ($state['research'] as $type => $level) {
                        $research->execute([$level, $uid, $type]);
                    }
                    $this->transferEconomy($cid, $state);
                    $this->transferQueues($uid, $cid, $draft, $state);
                    return [
                        'user' => ['id' => $uid, 'username' => $username],
                        'colony_id' => $cid,
                        'draft_mode' => false,
                    ];
                }
            );
        });
    }

    private function transferEconomy(int $cid, array $state): void
    {
        $e = $state['economy'];
        $this->db->prepare('INSERT INTO colony_economy_state (colony_id, settled_at, state_json) VALUES (?, ?, ?)')
            ->execute([$cid, $e['settled_at'], json_encode($e, JSON_THROW_ON_ERROR)]);
        $classes = $this->db->prepare(
            'INSERT INTO economy_pop_classes (colony_id, pop_class, count)
             VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE count = VALUES(count)'
        );
        foreach ($e['classes'] as $class => $count) {
            $classes->execute([$cid, $class, $count]);
        }
        $goods = $this->db->prepare(
            'INSERT INTO economy_processed_goods (colony_id, good_type, quantity, capacity)
             VALUES (?, ?, ?, 5000) ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)'
        );
        foreach ($e['stock'] as $good => $quantity) {
            if (!in_array($good, \GalaxyQuest\Economy\ColonyEconomySimulation::PRIMARY, true)) {
                $goods->execute([$cid, $good, $quantity]);
            }
        }
    }

    private function transferQueues(int $uid, int $cid, array $draft, array $state): void
    {
        foreach ($state['queues'] as $kind => $q) {
            $start = gmdate('Y-m-d H:i:s', $q['start']);
            $end = gmdate('Y-m-d H:i:s', $q['end']);
            if ($kind === 'research') {
                $this->db->prepare(
                    'UPDATE research SET research_start = ?, research_end = ? WHERE user_id = ? AND type = ?'
                )
                    ->execute([$start, $end, $uid, $q['type']]);
            } elseif ($kind === 'building' || $kind === 'ship') {
                $table = $kind === 'building' ? 'building_upgrade_queue' : 'ship_build_queue';
                $columns = $kind === 'building' ? 'building_type, target_level' : 'ship_type, quantity';
                $this->db->prepare("INSERT INTO $table (colony_id, $columns, cost_metal, cost_crystal, cost_deuterium,
                    duration_secs, queued_at, started_at, eta, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running')")
                    ->execute([$cid, $q['type'], $kind === 'building' ? $q['level'] : $q['count'],
                        $q['cost']['metal'] ?? 0, $q['cost']['crystal'] ?? 0, $q['cost']['deuterium'] ?? 0,
                        $q['end'] - $q['start'], $start, $start, $end]);
                if ($kind === 'building') {
                    $this->db->prepare('UPDATE buildings SET upgrade_end = ? WHERE colony_id = ? AND type = ?')
                        ->execute([$end, $cid, $q['type']]);
                }
            } elseif ($kind === 'fleet') {
                $p = $draft['position'];
                $this->db->prepare("INSERT INTO fleets (
                    user_id, origin_colony_id, target_galaxy, target_system, target_position,
                    mission, ships_json, departure_time, arrival_time, return_time, `returning`)
                    VALUES (?, ?, ?, ?, ?, 'recall', ?, ?, ?, ?, 1)")
                    ->execute([$uid, $cid, $p['galaxy'], $p['system'], $p['position'],
                        json_encode(['espionage_probe' => 1], JSON_THROW_ON_ERROR), $start, $end, $end]);
            }
        }
    }

    private function row(string $owner, bool $lock = false): array|false
    {
        $stmt = $this->db->prepare(
            'SELECT d.*, p.state_json, p.email, p.password_hash, p.verification_hash,
                    p.verification_expires_at, p.verification_sent_at, p.verification_attempts
             FROM registration_drafts d LEFT JOIN registration_play p ON p.draft_token = d.token
             WHERE d.selected_session_hash = ? AND d.expires_at > UTC_TIMESTAMP()' . ($lock ? ' FOR UPDATE' : '')
        );
        $stmt->execute([$owner]);
        return $stmt->fetch(PDO::FETCH_ASSOC);
    }

    private function requireRow(string $owner): array
    {
        $row = $this->row($owner, true);
        if (!$row || $row['state_json'] === null) {
            throw new RuntimeException('Playable draft is unavailable. Return to registration.', 410);
        }
        return $row;
    }

    private function publicState(array $row): array
    {
        $draft = json_decode($row['snapshot_json'], true, 512, JSON_THROW_ON_ERROR);
        $state = json_decode($row['state_json'], true, 512, JSON_THROW_ON_ERROR);
        return [
            'draft_mode' => true, 'expires_at' => null, 'world' => $draft, 'state' => $state,
            'email' => $row['email'], 'confirmation_pending' => $row['verification_hash'] !== null,
            'building_options' => array_map(static fn(string $type): array => [
                'type' => $type, 'label' => building_definitions()[$type]['label'],
                'cost' => building_cost($type, ($state['buildings'][$type] ?? 0) + 1),
            ], DraftWorldSimulation::BUILDINGS),
            'research_options' => array_map(static fn(string $type): array => [
                'type' => $type, 'cost' => research_cost($type, ($state['research'][$type] ?? 0) + 1),
            ], array_values(array_diff(array_keys(RESEARCH_BASE_COST), ['graviton_tech']))),
            'ship_options' => array_map(
                static fn(string $type): array => ['type' => $type, 'cost' => SHIP_STATS[$type]['cost']],
                ['small_cargo', 'light_fighter', 'espionage_probe']
            ),
        ];
    }

    private function transaction(Closure $work): mixed
    {
        $this->db->beginTransaction();
        try {
            $result = $work();
            $this->db->commit();
            return $result;
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
    }
}
