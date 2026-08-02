# AI Context Directory – GalaxyQuest Coding Standards

**Purpose**: Central reference for AI code generation, Copilot guidance, and team coding standards.

---

## 📚 CONTEXT FILES

### **Backend Architecture**
📄 [AI_CONTEXT_BACKEND_ARCHITECTURE.md](AI_CONTEXT_BACKEND_ARCHITECTURE.md)
- **Hybrid Model**: PHP (Game Logic) + Python (Specialized Services)
- **When to use PHP**: APIs, Database, Game Logic (<50ms responses)
- **When to use Python**: 3D Generation (TRELLIS2), Audio (TTS), ML, CLI Tools
- **Communication**: HTTP REST + Shared Database
- **Anti-patterns**: Sync Python calls, Direct shell_exec, Race Conditions
- **Deployment**: Docker Compose (isolated services)

### **Frontend Architecture**
📄 [AI_CONTEXT_FRONTEND_ARCHITECTURE.md](AI_CONTEXT_FRONTEND_ARCHITECTURE.md)
- **Framework**: Vanilla ES6+ (No React/Vue)
- **Architecture**: Layered (UI → Controller → Model → Storage)
- **State Management**: Observable Pattern (Pub/Sub)
- **Rendering**: Three.js + WebGPU/WebGL
- **Design Patterns**: Facade, Observer, Factory, Strategy
- **Anti-patterns**: Logic in Rendering, Global Pollution, Monolithic Controllers
- **Testing**: Unit (pure logic), Integration (UI+Logic), E2E (Playwright)

### **PHP Backend**
📄 [AI_CONTEXT_PHP.md](AI_CONTEXT_PHP.md)
- **Framework**: PHP 8.1+
- **Architecture**: Separation of Concerns (Controller/Service/Repository/Model)
- **Database**: MySQL 8.4 via PDO prepared statements
- **Caching**: gq_cache_* functions
- **Logging**: structlog with structured events
- **Standards**: Full type hints, no direct SQL in controllers
- **See also**: `.github/copilot-instructions.md` for coding rules

### **Python Services**
📄 [AI_CONTEXT_PYTHON.md](AI_CONTEXT_PYTHON.md)
- **Framework**: FastAPI 0.100+
- **Dependencies**: Pydantic 2.0, Python 3.11+
- **Architecture**: Router/Service/Repository/Schema layers
- **Async**: async/await for all I/O operations
- **HTTP Client**: httpx (not urllib)
- **Validation**: Pydantic models at boundaries
- **Standards**: Type hints, structlog, no blocking ops in async
- **See also**: `.github/copilot-instructions.md` for coding rules

### **JavaScript/ES6+**
📄 [AI_CONTEXT_JAVASCRIPT.md](AI_CONTEXT_JAVASCRIPT.md)
- **Focus**: Coding patterns and design principles
- **Module Pattern**: IIFE + exports to window namespace
- **State Management**: Observable pattern, EventBus
- **Rendering**: Separate from logic (testable)
- **Design Patterns**: Facade, Observer, Dependency Injection
- **Anti-patterns**: Circular deps, Global pollution, Logic in UI
- **See also**: [AI_CONTEXT_FRONTEND_ARCHITECTURE.md](AI_CONTEXT_FRONTEND_ARCHITECTURE.md) for layered architecture

---

## 🎯 QUICK DECISION TREE

### **New Feature: Which Tech Stack?**

```
┌─ "Frontend UI (buttons, panels, windows)"
│  └─ → Vanilla JavaScript + [AI_CONTEXT_FRONTEND_ARCHITECTURE.md](AI_CONTEXT_FRONTEND_ARCHITECTURE.md)
│
├─ "Game Logic (economy, fleet, combat)"
│  └─ → PHP API + [AI_CONTEXT_PHP.md](AI_CONTEXT_PHP.md)
│
├─ "3D Model Generation"
│  └─ → Python (TRELLIS2) + [AI_CONTEXT_BACKEND_ARCHITECTURE.md](AI_CONTEXT_BACKEND_ARCHITECTURE.md)
│
├─ "Audio Synthesis"
│  └─ → Python (TTS Service) + [AI_CONTEXT_BACKEND_ARCHITECTURE.md](AI_CONTEXT_BACKEND_ARCHITECTURE.md)
│
├─ "Real-time 3D Rendering"
│  └─ → Vanilla JS + Three.js + [AI_CONTEXT_FRONTEND_ARCHITECTURE.md](AI_CONTEXT_FRONTEND_ARCHITECTURE.md)
│
├─ "Database Query / Persistence"
│  └─ → PHP + [AI_CONTEXT_PHP.md](AI_CONTEXT_PHP.md)
│
├─ "CLI Tool / Data Migration"
│  └─ → Python Script + [AI_CONTEXT_PYTHON.md](AI_CONTEXT_PYTHON.md)
│
└─ "Batch Processing / DevOps"
   └─ → Python + [AI_CONTEXT_BACKEND_ARCHITECTURE.md](AI_CONTEXT_BACKEND_ARCHITECTURE.md)
```

---

## 📋 STANDARDS OVERVIEW

| Aspect | PHP | Python | JavaScript |
|--------|-----|--------|-----------|
| **Type Hints** | ✅ Required | ✅ Required | ✅ JSDoc |
| **Error Handling** | Specific exceptions | Specific exceptions | Try/catch + logging |
| **Async** | N/A (blocking OK) | ✅ async/await | ✅ Promises/await |
| **HTTP Client** | file_get_contents (OK) | httpx | fetch API |
| **Validation** | Pydantic models | Pydantic models | JSDoc + runtime checks |
| **Logging** | structlog | structlog | Logger service |
| **Testing** | Unit + Integration | Unit + Integration | Unit + Integration + E2E |
| **Database** | PDO prepared stmt | SQLAlchemy ORM | IndexedDB/API |

---

## 🔗 EXTERNAL REFERENCES

### **Architectural Deep Dives**
- [JAVASCRIPT_ARCHITECTURE_ANALYSIS.md](../JAVASCRIPT_ARCHITECTURE_ANALYSIS.md) – Layer mapping, boot sequence, dependency analysis
- [FULLSTACK_ARCHITECTURE_ANALYSIS.md](../FULLSTACK_ARCHITECTURE_ANALYSIS.md) – Frontend ↔ Backend integration

### **Project Standards**
- [.github/copilot-instructions.md](../.github/copilot-instructions.md) – Python & PHP coding standards
- [IMPLEMENTATION_ROADMAP.md](../IMPLEMENTATION_ROADMAP.md) – Feature timeline

### **Testing & QA**
- [TESTING_AND_PROFILING.md](../TESTING_AND_PROFILING.md) – Test suites, performance targets
- [playwright.config.js](../playwright.config.js) – E2E test configuration

---

## 🚀 WORKFLOW: Using These Context Files

### **1. Before Coding**
1. Identify which layer/tech (PHP/Python/JavaScript)
2. Read the corresponding Context file (AI_CONTEXT_*.md)
3. Check for anti-patterns section
4. Review examples in the file

### **2. During Coding**
1. Follow the design patterns in the context file
2. Use the code examples as templates
3. Keep layers separated
4. Add type hints / JSDoc

### **3. After Coding**
1. Run linter/formatter (ruff, prettier)
2. Write unit tests using patterns from context file
3. Check for circular dependencies
4. Verify error handling

### **4. Code Review**
1. Does it follow SOC principles from context file?
2. Are anti-patterns present?
3. Are dependencies explicit (Dependency Injection)?
4. Is it testable?

---

## 📞 QUESTIONS?

- **PHP Questions?** → [AI_CONTEXT_PHP.md](AI_CONTEXT_PHP.md) or `.github/copilot-instructions.md`
- **Python Questions?** → [AI_CONTEXT_PYTHON.md](AI_CONTEXT_PYTHON.md) or `.github/copilot-instructions.md`
- **JavaScript Questions?** → [AI_CONTEXT_JAVASCRIPT.md](AI_CONTEXT_JAVASCRIPT.md)
- **Architecture Questions?** → [AI_CONTEXT_FRONTEND_ARCHITECTURE.md](AI_CONTEXT_FRONTEND_ARCHITECTURE.md) + [AI_CONTEXT_BACKEND_ARCHITECTURE.md](AI_CONTEXT_BACKEND_ARCHITECTURE.md)
- **Integration Questions?** → [FULLSTACK_ARCHITECTURE_ANALYSIS.md](../FULLSTACK_ARCHITECTURE_ANALYSIS.md)

---

**Updated**: 2026-08-02  
**Maintained by**: Architecture Team  
**Last Review**: GitHub Copilot AI Context Audit
