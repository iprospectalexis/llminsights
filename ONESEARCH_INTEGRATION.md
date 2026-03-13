# OneSearch SERP API Integration

## Обзор

Приложение теперь поддерживает **два провайдера данных** для получения ответов от LLM:

1. **BrightData** - существующий провайдер (по умолчанию)
2. **OneSearch SERP API** - новый провайдер (добавлен в этой интеграции)

Администраторы могут выбирать провайдера для каждого LLM (SearchGPT, Perplexity, Gemini) отдельно в настройках Settings.

## Архитектура

### Workflow

```
User (Settings Page)
    ↓
Select Data Provider per LLM
    ↓
Start Audit
    ↓
run-audit function
    ↓
┌─────────────────────────────────────┐
│  Проверка настроек провайдера       │
│  для каждого LLM                    │
└─────────────────────────────────────┘
    ↓
┌──────────────────┐      ┌──────────────────┐
│  BrightData      │      │  OneSearch       │
│  (per prompt)    │      │  (batch job)     │
│  → snapshot_id   │      │  → job_id        │
└──────────────────┘      └──────────────────┘
    ↓                           ↓
llm_responses table
(с snapshot_id или job_id)
    ↓
poll-audit-results function
    ↓
┌──────────────────┐      ┌──────────────────┐
│  BrightData      │      │  OneSearch       │
│  Fetch snapshot  │      │  Fetch job       │
│  results         │      │  results         │
└──────────────────┘      └──────────────────┘
    ↓
Update llm_responses with answer_text
```

## Изменения в базе данных

### Migration: `add_onesearch_support`

```sql
-- Добавлены поля в llm_responses:
ALTER TABLE llm_responses
  ADD COLUMN data_provider text DEFAULT 'BrightData';
  ADD COLUMN job_id text;

-- Добавлено поле в audits:
ALTER TABLE audits
  ADD COLUMN data_provider text DEFAULT 'BrightData';

-- Индекс для job_id:
CREATE INDEX idx_llm_responses_job_id ON llm_responses (job_id);
```

### Таблица настроек провайдера

Уже существовала таблица `llm_data_provider_settings`:

```sql
CREATE TABLE llm_data_provider_settings (
  id uuid PRIMARY KEY,
  llm_name text UNIQUE NOT NULL, -- 'SearchGPT', 'Perplexity', 'Gemini'
  data_provider text NOT NULL,   -- 'BrightData', 'OneSearch SERP API'
  created_at timestamptz,
  updated_at timestamptz
);
```

По умолчанию все LLM настроены на BrightData.

## API OneSearch SERP

### Base URL
```
http://168.231.84.54:8000
```

### Authentication
```
X-API-Key: <your_api_key>
```

### Endpoints

#### 1. Create Job (POST /api/v1/jobs)

Создает batch job с массивом промптов.

**Request:**
```json
{
  "prompts": ["prompt 1", "prompt 2", ...],
  "geo_targeting": "US",
  "source": "chatgpt", // "chatgpt", "perplexity", "gemini"
  "provider": "serp"
}
```

**Response:**
```json
{
  "id": "job_123",
  "status": "pending",
  "total_prompts": 10,
  "estimated_batches": 1
}
```

#### 2. Get Job Status (GET /api/v1/jobs/{job_id})

Проверяет статус job.

**Response:**
```json
{
  "id": "job_123",
  "status": "completed", // "pending", "processing", "completed", "failed"
  "progress": 100,
  "total_prompts": 10,
  "processed_prompts": 10,
  "failed_prompts": 0
}
```

#### 3. Get Job Results (GET /api/v1/jobs/{job_id}/results?format=converted)

Получает результаты job.

**Response:**
```json
{
  "results": [
    {
      "prompt": "prompt text",
      "answer_text": "LLM answer...",
      "answer_text_markdown": "**LLM answer**...",
      "citations": [...],
      "sources": [...]
    }
  ]
}
```

## Реализованные Edge Functions

### 1. onesearch-api

Вспомогательная функция для взаимодействия с OneSearch API.

**Endpoints:**
- `/create-job` - создать job
- `/get-job-status` - проверить статус
- `/get-job-results` - получить результаты

### 2. run-audit (обновлен)

Теперь поддерживает роутинг к двум провайдерам:

1. Читает настройки провайдера для каждого LLM из `llm_data_provider_settings`
2. Группирует LLM по провайдеру
3. Для BrightData - отправляет индивидуальный запрос на каждый prompt
4. Для OneSearch - создает batch job с массивом промптов
5. Сохраняет `snapshot_id` (BrightData) или `job_id` (OneSearch) в `llm_responses`

### 3. poll-audit-results (обновлен)

Теперь поллит оба провайдера:

1. Группирует pending responses по `data_provider`
2. Для BrightData - fetches snapshot results индивидуально
3. Для OneSearch - fetches job results и матчит по prompt text
4. Обновляет `llm_responses` с ответами

### 4. test-data-provider (обновлен)

Добавлена функция `testOneSearchSERP()`:

1. Создает тестовый job с одним промптом
2. Ждет completion (макс 5 минут)
3. Возвращает результаты или timeout статус

## Как использовать

### 1. Настройка API ключа

Добавьте OneSearch API ключ в `.env`:

```env
ONESEARCH_API_URL=http://168.231.84.54:8000
ONESEARCH_API_KEY=your_api_key_here
```

### 2. Выбор провайдера

1. Перейдите в **Settings**
2. В разделе **Data Providers** выберите провайдера для каждого LLM
3. Нажмите **Save Settings**

### 3. Тестирование провайдера

1. В разделе **Test a Data Provider**
2. Выберите LLM и Data Provider
3. Введите тестовый промпт
4. Нажмите **Send**

Для BrightData результат вернется сразу (snapshot_id).
Для OneSearch SERP API функция будет ждать до 5 минут для получения результата.

### 4. Запуск аудита

Запустите аудит как обычно. Система автоматически:
- Прочитает настройки провайдера для выбранных LLM
- Отправит запросы к соответствующим провайдерам
- Будет поллить результаты из обоих провайдеров

## Сравнение провайдеров

| Аспект | BrightData | OneSearch SERP API |
|--------|-----------|-------------------|
| **Метод** | Индивидуальные запросы | Batch jobs |
| **Идентификатор** | `snapshot_id` | `job_id` |
| **Скорость** | Зависит от LLM (~30-120s) | Batch processing (~60-180s) |
| **Cost Efficiency** | Плата за запрос | Плата за batch |
| **Retry Logic** | Per prompt | Per job |
| **Поддерживаемые LLM** | SearchGPT, Perplexity, Gemini | ChatGPT, Perplexity, Gemini, Copilot |

## Обработка ошибок

### BrightData
- Timeout: 60 секунд на trigger, 45 секунд на poll
- Retry: На уровне поллинга (frontend или cron)
- Ошибки сохраняются в `raw_response_data`

### OneSearch
- Timeout: 60 секунд на job creation, 30 секунд на status/results
- Job status: Может быть "failed" с error_message
- Ошибки сохраняются в `raw_response_data`

## Мониторинг

### Проверка статуса аудита

```sql
SELECT
  a.id,
  a.status,
  a.data_provider,
  COUNT(lr.id) as total_responses,
  COUNT(lr.answer_text) as completed_responses,
  COUNT(CASE WHEN lr.raw_response_data ? 'error' THEN 1 END) as failed_responses
FROM audits a
LEFT JOIN llm_responses lr ON lr.audit_id = a.id
WHERE a.id = '<audit_id>'
GROUP BY a.id;
```

### Проверка OneSearch jobs

```sql
SELECT
  lr.llm,
  lr.job_id,
  COUNT(*) as prompts_count,
  COUNT(lr.answer_text) as completed_count
FROM llm_responses lr
WHERE lr.data_provider = 'OneSearch SERP API'
AND lr.audit_id = '<audit_id>'
GROUP BY lr.llm, lr.job_id;
```

## Troubleshooting

### Проблема: OneSearch API не отвечает

**Решение:**
1. Проверьте, что `ONESEARCH_API_KEY` настроен в Supabase secrets
2. Проверьте доступность API: `curl http://168.231.84.54:8000/health`
3. Проверьте лимиты API ключа в OneSearch Dashboard

### Проблема: Results не появляются

**Решение:**
1. Проверьте статус job вручную через API
2. Проверьте логи edge function `poll-audit-results`
3. Убедитесь, что prompt text точно совпадает между request и response

### Проблема: Смешанные провайдеры в одном аудите

**Решение:**
Это нормально! Аудит может использовать оба провайдера одновременно:
- SearchGPT через OneSearch
- Perplexity через BrightData
- Gemini через BrightData

Каждый LLM response имеет поле `data_provider` для идентификации.

## Миграция с BrightData на OneSearch

Для существующих проектов:

1. Все существующие audits используют BrightData (по умолчанию)
2. Новые audits будут использовать провайдер из настроек
3. Можно изменить настройки в любой момент
4. Старые данные остаются неизменными

Миграция данных не требуется - старые `llm_responses` имеют `data_provider = 'BrightData'` автоматически.

## Тестовые скрипты

### Node.js
```bash
node scripts/test-brightdata.js searchgpt "test prompt"
```

### Deno
```bash
deno run --allow-net --allow-env scripts/test-brightdata.ts perplexity "test prompt"
```

Эти скрипты работают с BrightData напрямую. Для тестирования OneSearch используйте Settings > Test Data Provider в приложении.

## Дальнейшие улучшения

1. **Rate Limiting**: Добавить контроль лимитов для OneSearch API
2. **Caching**: Кэшировать результаты job для повторных запросов с теми же промптами
3. **Analytics**: Сравнение производительности BrightData vs OneSearch
4. **Cost Tracking**: Отслеживание стоимости запросов по провайдерам
5. **Webhook Support**: Использовать OneSearch webhooks вместо поллинга
6. **Retry Logic**: Автоматический retry для failed jobs
7. **Priority Queue**: Приоритизация важных jobs

## Заключение

Интеграция OneSearch SERP API успешно завершена! Приложение теперь поддерживает два провайдера данных с гибким выбором на уровне каждого LLM.

Основные преимущества:
- Гибкость выбора провайдера
- Поддержка batch processing через OneSearch
- Обратная совместимость с BrightData
- Централизованное управление в Settings
- Встроенное тестирование провайдеров
