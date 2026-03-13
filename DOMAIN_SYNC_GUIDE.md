# Domain Synchronization Guide

## Overview

После завершения аудитов домены из citations должны быть синхронизированы в таблицу `domains` для классификации и анализа брендов/конкурентов.

## Автоматическая синхронизация

### Функция: `sync_domains_from_citations()`

Синхронизирует уникальные домены из таблицы `citations` в таблицу `domains` с подсчетом количества цитирований.

**Использование:**

```sql
-- Синхронизировать все проекты
SELECT * FROM sync_domains_from_citations();

-- Синхронизировать конкретный проект
SELECT * FROM sync_domains_from_citations('project-uuid');

-- Синхронизировать несколько проектов
SELECT
  p.name as project_name,
  s.domains_inserted,
  s.domains_updated
FROM projects p
CROSS JOIN LATERAL sync_domains_from_citations(p.id) s
WHERE p.name ILIKE '%balenciaga%';
```

**Возвращает:**
- `synced_project_id` - UUID проекта
- `domains_inserted` - Количество новых доменов
- `domains_updated` - Количество обновленных доменов

## Процесс синхронизации

1. **Извлечение уникальных доменов**
   - Из таблицы `citations` группируются уникальные домены по проекту
   - Подсчитывается количество цитирований для каждого домена

2. **Upsert в таблицу domains**
   - Если домен уже существует → обновляется `citation_count` и `updated_at`
   - Если домен новый → создается запись с `classification = 'Others'`

3. **Классификация по умолчанию**
   - Все новые домены получают классификацию `'Others'`
   - Пользователь может изменить классификацию вручную или через AI

## Структура таблицы domains

```sql
CREATE TABLE domains (
  id uuid PRIMARY KEY,
  domain text NOT NULL,
  classification domain_classification DEFAULT 'Others',
  project_id uuid REFERENCES projects(id),
  citation_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_domain_per_project UNIQUE (project_id, domain)
);
```

## Доступные классификации

Enum `domain_classification` содержит следующие значения:

- `Brand/Corporate` - Официальные сайты брендов и компаний
- `Ecommerce` - Интернет-магазины
- `News/Media` - Новостные и медиа издания
- `Government/NGO` - Государственные и некоммерческие организации
- `Social Media` - Социальные сети
- `UGC` - User Generated Content (форумы, отзывы)
- `Academic` - Академические ресурсы
- `Encyclopedia` - Энциклопедии (Wikipedia и т.д.)
- `Video` - Видео платформы (YouTube и т.д.)
- `Blogs/Personal` - Блоги и персональные сайты
- `Others` - Прочие (по умолчанию)

## Примеры использования

### Синхронизация после завершения аудита

```sql
-- После завершения аудита синхронизируем домены
SELECT sync_domains_from_citations('80bb6ad3-1e8b-4210-8ade-489cd6f125e4'::uuid);
```

### Проверка результатов синхронизации

```sql
-- Топ доменов по количеству цитирований
SELECT
  domain,
  citation_count,
  classification
FROM domains
WHERE project_id = 'project-uuid'
ORDER BY citation_count DESC
LIMIT 20;
```

### Массовая классификация доменов

```sql
-- Классифицировать известные домены вручную
UPDATE domains
SET classification = 'News/Media'
WHERE domain IN ('vogue.com', 'forbes.com', 'harpersbazaar.com', 'elle.com')
  AND project_id = 'project-uuid';

UPDATE domains
SET classification = 'Ecommerce'
WHERE domain IN ('zalando.de', 'mytheresa.com', 'farfetch.com', 'net-a-porter.com')
  AND project_id = 'project-uuid';

UPDATE domains
SET classification = 'Video'
WHERE domain IN ('youtube.com', 'youtube')
  AND project_id = 'project-uuid';

UPDATE domains
SET classification = 'Brand/Corporate'
WHERE domain IN ('balenciaga.com', 'gucci.com')
  AND project_id = 'project-uuid';
```

## Интеграция с Materialized Views

После синхронизации доменов обновите `domain_citations_mv`:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY domain_citations_mv;
```

Это обновит агрегированные данные по доменам для быстрого доступа.

## Автоматизация

Для автоматической синхронизации после каждого аудита можно создать триггер:

```sql
-- Автоматически синхронизировать домены при завершении аудита
CREATE OR REPLACE FUNCTION auto_sync_domains_on_audit_completion()
RETURNS TRIGGER AS $$
BEGIN
  -- Если аудит только что завершен
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    -- Асинхронно запускаем синхронизацию
    PERFORM sync_domains_from_citations(NEW.project_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_sync_domains_trigger
  AFTER UPDATE ON audits
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION auto_sync_domains_on_audit_completion();
```

## Мониторинг

### Проверка количества доменов

```sql
SELECT
  p.name as project_name,
  COUNT(d.id) as total_domains,
  COUNT(CASE WHEN d.classification != 'Others' THEN 1 END) as classified_domains,
  COUNT(CASE WHEN d.citation_count >= 10 THEN 1 END) as domains_10plus_citations
FROM projects p
LEFT JOIN domains d ON d.project_id = p.id
GROUP BY p.name
ORDER BY total_domains DESC;
```

### Проверка распределения по классификациям

```sql
SELECT
  classification,
  COUNT(*) as domain_count,
  SUM(citation_count) as total_citations
FROM domains
WHERE project_id = 'project-uuid'
GROUP BY classification
ORDER BY domain_count DESC;
```

## Результаты синхронизации для Balenciaga (12 марта 2026)

| Project | Domains Inserted | Total Citations | Top Domains |
|---------|-----------------|-----------------|-------------|
| Balenciaga DE | 2,250 | 7,165 | whowhatwear.com (102), youtube (92), zalando.de (87) |
| Balenciaga IT | 1,992 | 5,418 | whowhatwear.com (92), vogue.com (75), harpersbazaar.com (72) |
| Balenciaga JP | 1,690 | 4,204 | whowhatwear.com (75), youtube.com (62), elle.com (55) |
| Balenciaga UK | 1,349 | 3,496 | reddit.com (120), whowhatwear.com (82), youtube.com (72) |

Все домены готовы для классификации и анализа конкурентов/брендов.
