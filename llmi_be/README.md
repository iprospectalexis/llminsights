# SERP SaaS API (Lite)

Облегчённая версия без Docker, Celery и Redis. Использует SQLite и встроенные фоновые задачи FastAPI.

## 🚀 Быстрый старт

### 1. Установка

```powershell
# Перейти в папку проекта
cd serp-saas-api-lite

# Создать виртуальное окружение
python -m venv venv

# Активировать (Windows PowerShell)
.\venv\Scripts\Activate.ps1

# Или для CMD
venv\Scripts\activate.bat

# Установить зависимости
pip install -r requirements.txt
```

### 2. Настройка

```powershell
# Создать .env файл
copy .env.example .env
```

Отредактируй `.env`:
```env
SERP_API_KEY=твой_ключ_serp_api
```

### 3. Запуск

```powershell
# Запустить сервер
uvicorn app.main:app --reload --port 8000
```

Готово! API доступен по адресу: http://localhost:8000

## 📚 Документация

| URL | Описание |
|-----|----------|
| http://localhost:8000/docs | Swagger UI |
| http://localhost:8000/redoc | ReDoc |
| http://localhost:8000/health | Health check |

## 🔧 Примеры использования

### Создать job

```powershell
curl -X POST http://localhost:8000/api/v1/jobs `
  -H "Content-Type: application/json" `
  -d '{\"prompts\": [\"Quel est le meilleur croissant de Paris ?\", \"Où manger le meilleur falafel dans le Marais ?\"]}'
```

Или в PowerShell с Invoke-RestMethod:

```powershell
$body = @{
    prompts = @(
        "Quel est le meilleur croissant de Paris ?",
        "Où manger le meilleur falafel dans le Marais ?"
    )
    webhook_url = "https://webhook.site/your-unique-url"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:8000/api/v1/jobs" -Method Post -Body $body -ContentType "application/json"
```

### Проверить статус job

```powershell
Invoke-RestMethod -Uri "http://localhost:8000/api/v1/jobs/{job_id}" -Method Get
```

### Список всех jobs

```powershell
Invoke-RestMethod -Uri "http://localhost:8000/api/v1/jobs" -Method Get
```

### Отменить job

```powershell
Invoke-RestMethod -Uri "http://localhost:8000/api/v1/jobs/{job_id}" -Method Delete
```

## 📁 Структура проекта

```
serp-saas-api-lite/
├── .env.example        # Шаблон переменных окружения
├── requirements.txt    # Python зависимости
├── serp_jobs.db       # SQLite база (создаётся автоматически)
├── app/
│   ├── main.py        # FastAPI приложение
│   ├── config.py      # Настройки
│   ├── database.py    # SQLite подключение
│   ├── api/
│   │   └── v1/
│   │       └── endpoints/
│   │           └── jobs.py    # API эндпоинты
│   ├── models/
│   │   └── job.py     # SQLAlchemy модель
│   ├── schemas/
│   │   └── job.py     # Pydantic схемы
│   └── services/
│       ├── serp_client.py     # Клиент SERP API
│       ├── webhook.py         # Отправка webhooks
│       └── job_processor.py   # Фоновая обработка
└── README.md
```

## 🔄 Webhook

Когда job завершается, на указанный URL отправляется POST:

```json
{
  "event": "job.completed",
  "job_id": "uuid",
  "status": "completed",
  "progress": 100,
  "total_prompts": 2,
  "processed_prompts": 2,
  "failed_prompts": 0,
  "results": ["https://...file.json"],
  "duration_seconds": 45,
  "completed_at": "2024-01-15T10:30:50Z"
}
```

## ⚠️ Ограничения Lite версии

| Функция | Full версия | Lite версия |
|---------|-------------|-------------|
| База данных | PostgreSQL | SQLite |
| Очередь задач | Celery + Redis | asyncio tasks |
| Масштабирование | Много workers | Один процесс |
| Персистентность задач | Да | Нет (теряются при рестарте) |
| Мониторинг | Flower | Нет |

**Lite версия подходит для:**
- Локальной разработки
- Тестирования
- Небольших нагрузок (до ~10 одновременных jobs)

## 🐛 Troubleshooting

### "SERP_API_KEY is required"
Убедись, что `.env` файл создан и содержит `SERP_API_KEY=...`

### Job застрял в "processing"
Перезапусти сервер — в Lite версии задачи не сохраняются между рестартами.

### "ModuleNotFoundError"
Убедись, что виртуальное окружение активировано:
```powershell
.\venv\Scripts\Activate.ps1
```

## 📄 License

MIT
