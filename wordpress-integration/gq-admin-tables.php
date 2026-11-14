<?php

declare(strict_types=1);

namespace GalaxyQuest\WordPress;

if (!class_exists(AdminTablesV1::class, false)) {
    final class AdminTablesV1
    {
        public static function header(array $headings): void
        {
            echo '<thead';
            foreach (
                [
                    'search' => 'Search', 'sort' => 'Sort', 'filter' => 'Filter',
                    'reset' => 'Reset view', 'all' => 'All values', 'empty' => 'No matching records.',
                ] as $key => $label
            ) {
                echo ' data-' . $key . '="' . esc_attr(__($label, 'gq-admin-tables')) . '"';
            }
            echo '><tr>';
            foreach ($headings as $heading) {
                echo '<th scope="col">' . esc_html__($heading, 'gq-admin-tables') . '</th>';
            }
            echo '</tr></thead>';
        }

        public static function assets(): void
        {
            echo '<script>' . self::SCRIPT . '</script>';
        }

        private const SCRIPT = <<<'JS'
(() => {
    document.querySelectorAll('table[data-gq-admin-table]:not([data-gq-ready])').forEach(table => {
        table.dataset.gqReady = 'true';
        const body = table.tBodies[0];
        const head = table.tHead;
        if (!body || !head) return;
        const headings = [...head.rows[0].cells];
        const rows = [...body.rows];
        const values = rows.map(row => [...row.cells].map(cell => cell.textContent.trim()));
        const controls = [];
        let sortColumn = -1;
        let direction = 1;
        const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});
        const make = (tag, text) => {
            const element = document.createElement(tag);
            if (text !== undefined) element.textContent = text;
            return element;
        };
        const toolbar = head.insertRow();
        const toolbarCell = document.createElement('th');
        toolbarCell.colSpan = headings.length;
        toolbar.append(toolbarCell);
        const reset = make('button', head.dataset.reset || 'Reset view');
        reset.type = 'button';
        reset.className = 'button';
        const count = make('span');
        count.setAttribute('role', 'status');
        count.setAttribute('aria-live', 'polite');
        toolbarCell.append(reset, document.createTextNode(' '), count);
        const empty = make('tr');
        const emptyCell = make('td', head.dataset.empty || 'No matching records.');
        emptyCell.colSpan = headings.length;
        empty.append(emptyCell);
        const update = () => {
            let visible = 0;
            const ordered = rows.map((row, index) => ({row, index}));
            if (sortColumn >= 0) ordered.sort((a, b) =>
                direction * collator.compare(values[a.index][sortColumn], values[b.index][sortColumn])
                    || a.index - b.index);
            ordered.forEach(({row, index}) => {
                row.hidden = controls.some(({search, filter}, column) =>
                    !values[index][column].toLocaleLowerCase().includes(search.value.toLocaleLowerCase())
                        || (filter.value !== '' && filter.value !== values[index][column]));
                if (!row.hidden) visible++;
                body.append(row);
            });
            empty.hidden = visible !== 0;
            body.append(empty);
            count.textContent = `${visible} / ${rows.length}`;
            headings.forEach((heading, index) => heading.setAttribute('aria-sort',
                index === sortColumn ? (direction === 1 ? 'ascending' : 'descending') : 'none'));
        };
        headings.forEach((heading, column) => {
            const title = heading.textContent.trim();
            const sort = make('button', title);
            sort.type = 'button';
            sort.className = 'button-link';
            sort.setAttribute('aria-label', `${head.dataset.sort || 'Sort'}: ${title}`);
            sort.addEventListener('click', () => {
                direction = sortColumn === column ? -direction : 1;
                sortColumn = column;
                update();
            });
            const search = make('input');
            search.type = 'search';
            search.style.maxWidth = '100%';
            search.setAttribute('aria-label', `${head.dataset.search || 'Search'}: ${title}`);
            const filter = make('select');
            filter.style.maxWidth = '100%';
            filter.setAttribute('aria-label', `${head.dataset.filter || 'Filter'}: ${title}`);
            const all = make('option', head.dataset.all || 'All values');
            all.value = '';
            filter.append(all);
            [...new Set(values.map(row => row[column]))].filter(value => value !== '')
                .sort(collator.compare).forEach(value => {
                    const option = make('option', value);
                    option.value = value;
                    filter.append(option);
                });
            search.addEventListener('input', update);
            filter.addEventListener('change', update);
            heading.replaceChildren(sort, make('br'), search, make('br'), filter);
            controls.push({search, filter});
        });
        reset.addEventListener('click', () => {
            controls.forEach(({search, filter}) => { search.value = ''; filter.value = ''; });
            sortColumn = -1;
            update();
        });
        update();
    });
})();
JS;
    }
}
