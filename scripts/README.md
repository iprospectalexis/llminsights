# Scripts

## Test Scheduled Audits

Script for safely testing scheduled audit functionality without affecting running audits.

### Usage

```bash
node scripts/test-scheduled-audits.js
```

### What the script does

1. Checks all projects with scheduled audits enabled
2. Identifies which projects have active (running/pending) audits
3. Only updates projects that are available for scheduling
4. Triggers the scheduler to create new audits
5. Shows detailed status of what happened

### Example Output

```
🔍 Checking scheduled audit projects...

Found 6 project(s) with scheduled audits:

✅ La Marine Nationale - Ready for scheduling
✅ Le Figaro - Ready for scheduling
⏳ Police Nationale - Has running audit (skipping)
✅ Polestar - AO - Ready for scheduling
✅ Salomon 2 - Ready for scheduling
✅ SP-100 - Ready for scheduling

============================================================

📅 Scheduling 5 project(s)...

✅ Updated next_scheduled_audit_at for eligible projects

🚀 Triggering scheduler...

✅ Scheduler completed:

   Created: 5 audit(s)
   Skipped: 1 project(s)

============================================================

✅ Test completed successfully!
```

### Benefits

- Safe: Only schedules audits for projects without active audits
- Clear: Shows exactly what will happen before making changes
- Non-destructive: Doesn't cancel or modify existing audits
- Informative: Provides detailed feedback on the process

---

## Reprocess Audit Results

Скрипт для восстановления данных аудита из OneSearch API при сбое webhook или отсутствии данных.

### Использование

```bash
node scripts/reprocess-audit.js <AUDIT_ID> [JOB_ID]
```

### Примеры

Обработать все job_id для аудита:
```bash
node scripts/reprocess-audit.js e02171c9-39ae-440a-b906-8e42fab52b66
```

Обработать конкретный job_id:
```bash
node scripts/reprocess-audit.js e02171c9-39ae-440a-b906-8e42fab52b66 74f4ea65-2766-4561-87cb-5c5c4e853e6a
```

### Что делает скрипт

1. Получает все llm_responses для аудита
2. Загружает результаты из OneSearch API для каждого job_id
3. Сопоставляет ответы с промптами
4. Обновляет базу данных с answer_text, цитатами и метаданными
5. Запускает извлечение конкурентов и анализ тональности
6. Завершает аудит, если все данные обработаны

---

# BrightData API Test Scripts

Скрипты для тестирования запросов к BrightData API для SearchGPT, Perplexity и Gemini.

## Доступные версии

- **Node.js** (`test-brightdata.js`) - работает на Node.js 18+
- **Deno** (`test-brightdata.ts`) - работает на Deno с TypeScript

## Предварительные требования

Установите переменную окружения с вашим API ключом BrightData:

```bash
export BRIGHTDATA_API_KEY="your_api_key_here"
```

Или создайте файл `.env` в корне проекта:

```env
BRIGHTDATA_API_KEY=your_api_key_here
```

## Использование

### Node.js версия

```bash
# Установка зависимостей не требуется - использует встроенный fetch

# SearchGPT
node scripts/test-brightdata.js searchgpt "What are the best CRM tools for small business?"

# Perplexity
node scripts/test-brightdata.js perplexity "How to improve SEO for e-commerce?"

# Gemini
node scripts/test-brightdata.js gemini "Best practices for React performance"
```

### Deno версия

```bash
# SearchGPT
deno run --allow-net --allow-env scripts/test-brightdata.ts searchgpt "What are the best CRM tools?"

# Perplexity
deno run --allow-net --allow-env scripts/test-brightdata.ts perplexity "How to improve SEO?"

# Gemini
deno run --allow-net --allow-env scripts/test-brightdata.ts gemini "Best React practices"
```

## Поддерживаемые LLM

| LLM | Название | Dataset ID |
|-----|---------|------------|
| `searchgpt` | ChatGPT Search | `gd_m7aof0k82r803d5bjm` |
| `perplexity` | Perplexity AI | `gd_m7dhdot1vw9a7gc1n` |
| `gemini` | Google Gemini | `gd_mbz66arm2mf9cu856y` |

## Как это работает

### 1. Trigger Phase (Запуск запроса)

Скрипт отправляет POST запрос к BrightData API для запуска scraping задачи:

```
POST https://api.brightdata.com/datasets/v3/trigger?dataset_id=xxx&include_errors=true
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

Payload (SearchGPT):
{
  "url": "https://chatgpt.com/",
  "prompt": "Your question here",
  "country": "US",
  "web_search": true,
  "additional_prompt": ""
}

Response:
{
  "snapshot_id": "abc123xyz"
}
```

### 2. Polling Phase (Получение результатов)

После получения `snapshot_id`, скрипт начинает поллинг результатов:

```
GET https://api.brightdata.com/datasets/v3/snapshot/abc123xyz?format=json
Authorization: Bearer YOUR_API_KEY

Response (когда готово):
[
  {
    "url": "https://chatgpt.com/",
    "timestamp": "2025-01-22T10:30:00Z",
    "answer_text": "Based on your requirements...",
    "answer_text_markdown": "**Based on your requirements...**",
    "web_search_query": "best CRM tools small business",
    "citations": [
      {
        "url": "https://example.com/crm-tools",
        "text": "Best CRM Software for 2025"
      }
    ]
  }
]
```

### 3. Retry Logic

- **Trigger timeout**: 60 секунд
- **Polling attempts**: до 30 попыток
- **Polling delay**: 10 секунд между попытками
- **Polling timeout per request**: 45 секунд

Если результат не готов (HTTP 404), скрипт ждет 10 секунд и повторяет запрос.

## Структура ответа

### SearchGPT

```json
{
  "url": "https://chatgpt.com/",
  "timestamp": "2025-01-22T10:30:00Z",
  "answer_text": "Full text answer",
  "answer_text_markdown": "**Markdown** formatted answer",
  "web_search_query": "actual search query used",
  "citations": [
    {
      "url": "https://source.com",
      "text": "Citation title or text"
    }
  ]
}
```

### Perplexity

```json
{
  "url": "https://www.perplexity.ai",
  "timestamp": "2025-01-22T10:30:00Z",
  "answer_text": "Full text answer",
  "answer_text_markdown": "**Markdown** formatted answer",
  "sources": [
    {
      "url": "https://source.com",
      "title": "Source title",
      "description": "Source description"
    }
  ]
}
```

### Gemini

```json
{
  "url": "https://gemini.google.com/",
  "timestamp": "2025-01-22T10:30:00Z",
  "answer_text": "Full text answer",
  "links_attached": [
    {
      "url": "https://source.com",
      "text": "Link text",
      "position": 1
    }
  ]
}
```

## Примеры вывода

```
🔬 BrightData API Test Script
════════════════════════════════════════════════════════════════════════════════

🚀 Triggering searchgpt query...
📝 Prompt: "What are the best CRM tools for small business?"
🌍 Country: US

✅ Query triggered successfully!
📸 Snapshot ID: 1234567890abcdef

⏳ Polling for results (max 30 attempts)...

⏱️  Attempt 1/30: Result not ready yet, waiting 10s...
⏱️  Attempt 2/30: Result not ready yet, waiting 10s...

✅ Results received after 3 attempt(s)!

════════════════════════════════════════════════════════════════════════════════
📊 RESULTS FOR SEARCHGPT
════════════════════════════════════════════════════════════════════════════════

📍 URL: https://chatgpt.com/
⏰ Timestamp: 2025-01-22T10:30:00Z
🔍 Web Search Query: best CRM tools for small business 2025

💬 ANSWER:

Based on your requirements, here are the top CRM tools for small businesses...

📚 CITATIONS (3):
  1. Best CRM Software for Small Business 2025
     🔗 https://www.example.com/best-crm
  2. Top 10 CRM Solutions Compared
     🔗 https://www.example2.com/crm-comparison
  3. Small Business CRM Guide
     🔗 https://www.example3.com/guide

════════════════════════════════════════════════════════════════════════════════

🔧 METADATA:
  - Is Map: false
  - Shopping Visible: false
  - Has Shopping Data: No

✨ Test completed successfully!

⏱️  Total execution time: 45.32s
```

## Обработка ошибок

Скрипт обрабатывает следующие ошибки:

- **Missing API Key**: Проверяет наличие `BRIGHTDATA_API_KEY`
- **Invalid LLM**: Проверяет, что LLM из списка: searchgpt, perplexity, gemini
- **API Errors**: Выводит статус код и сообщение ошибки от BrightData
- **Timeouts**: При превышении времени ожидания выбрасывает ошибку
- **Network Errors**: Обрабатывает сетевые ошибки и повторяет запрос

## Использование в продакшене

Для использования в production коде:

1. **Используйте очереди** (Bull, BullMQ, RabbitMQ) для обработки trigger и polling
2. **Настройте retry logic** с exponential backoff
3. **Добавьте мониторинг** для отслеживания успешности запросов
4. **Используйте Dead Letter Queue** для failed jobs
5. **Кэшируйте результаты** чтобы не делать дублирующие запросы
6. **Rate limiting** - соблюдайте лимиты BrightData API

## Troubleshooting

**Ошибка: "BRIGHTDATA_API_KEY environment variable is not set"**
- Убедитесь, что установлена переменная окружения `BRIGHTDATA_API_KEY`

**Ошибка: "Timeout: Results not available after 30 attempts"**
- Увеличьте `maxAttempts` в функции `pollResults()`
- Проверьте статус задачи в BrightData Dashboard

**Ошибка: "BrightData API error: 401"**
- Проверьте корректность API ключа
- Убедитесь, что ключ имеет доступ к нужным dataset_id

**Ошибка: "BrightData API error: 429"**
- Достигнут rate limit
- Добавьте delay между запросами или увеличьте план BrightData

## Дополнительная информация

- [BrightData API Documentation](https://docs.brightdata.com/)
- [Dataset Triggers API](https://docs.brightdata.com/scraping-automation/web-data-apis/web-scraper-api/overview)
- [Snapshot Retrieval](https://docs.brightdata.com/scraping-automation/web-data-apis/web-scraper-api/snapshot)
