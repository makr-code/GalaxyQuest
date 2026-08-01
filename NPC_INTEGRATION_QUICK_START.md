# NPC Interaction Integration Guide

## Quick Start

Die NPC-Dialoge sind jetzt mit den Spielereignissen verbunden. Es gibt zwei Wege, um ein NPC-Dialogfeld zu öffnen:

### 1. **Direkt per JavaScript-Aufruf**

```javascript
// Öffnen Sie ein NPC-Dialogfeld für einen bestimmten NPC
window.openNpcDialog('npc_commander_01', 'Commander Vex', 'Federation');

// Schließen Sie das aktuelle Dialogfeld
window.closeNpcDialog();

// Rufen Sie das aktive Panel ab
const panel = window.getNpcPanel();
```

### 2. **HTML-Attribut-basiert (Klick-Delegierung)**

Fügen Sie einer Schaltfläche oder einem Element diese Attribute hinzu:
```html
<button 
  data-npc-id="npc_diplomat_01" 
  data-npc-name="Envoy Salix" 
  data-npc-faction="Empire"
  class="npc-click-button"
>
  Talk to Diplomat
</button>
```

Der `NpcInteractionHandler` lauscht automatisch auf Klicks auf Elemente mit `data-npc-id` und öffnet das Panel.

### 3. **Programmgesteuert an Elementen anfügen**

```javascript
const button = document.querySelector('#my-npc-button');
window.GQNpcInteractionHandler.attachToElement(
  button, 
  'npc_merchant_01', 
  'Trader Kess', 
  'Neutral'
);
```

## Integration mit Fraktions-UI (RuntimeFactionsController)

Wenn ein NPC in der Fraktions-UI angeklickt wird, ersetzen Sie `openNpcChat()` durch:

```javascript
// In RuntimeFactionsController.openNpcChat(root, fid)
async openNpcChat(root, fid) {
  const faction = this.getFactionById(fid);
  if (!faction) return;
  
  // Erstellen Sie NPC-ID und Namen aus Fraktionsdaten
  const npcId = 'npc_' + String(faction.code).toLowerCase() + '_01';
  const npcName = String(faction.diplomat_npc || 'Unknown NPC');
  
  // Öffnen Sie das neue Panel
  if (window.openNpcDialog) {
    window.openNpcDialog(npcId, npcName, faction.code);
  }
}
```

## Event-System

Der `NpcInteractionHandler` versendet folgende Events:

```javascript
// NPC-Dialog geöffnet
document.addEventListener('npcDialogOpened', (e) => {
  console.log('Dialog geöffnet:', e.detail.npcId, e.detail.npcName);
});

// NPC-Dialog geschlossen
document.addEventListener('npcDialogClosed', (e) => {
  console.log('Dialog geschlossen:', e.detail.npcId);
});
```

## Globale Funktionen

Nach der Initialisierung sind diese Funktionen global verfügbar:

- `window.openNpcDialog(npcId, npcName, faction)` - Öffnet das NPC-Dialogfeld
- `window.closeNpcDialog()` - Schließt das aktive Dialogfeld
- `window.getNpcPanel()` - Ruft das aktive Panel-Objekt ab
- `window.GQNpcInteractionHandler` - Der Handler-Instanz für erweiterte Kontrolle

## Debugging

Aktivieren Sie Debug-Modus:

```javascript
window.GQNpcInteractionHandler.options.debug = true;
// Alle Aktionen werden in die Konsole geloggt
```

## CSS-Styling für klickbare NPCs

Optional fügen Sie einen Hover-Effekt für klickbare NPC-Elemente hinzu:

```css
[data-npc-id] {
  cursor: pointer;
  position: relative;
}

[data-npc-id]:hover {
  opacity: 0.8;
  text-decoration: underline;
}
```

## Beispiel: NPC im Leaders Panel

```javascript
// In a leaders list renderer:
const npcElement = document.createElement('div');
npcElement.className = 'leader-item';
npcElement.setAttribute('data-npc-id', leader.npc_id);
npcElement.setAttribute('data-npc-name', leader.name);
npcElement.setAttribute('data-npc-faction', leader.faction);
npcElement.textContent = leader.name;

// Klicken Sie auf das Element öffnet das NPC-Dialogfeld
</script>
```

## Performance-Notizen

- Der Handler verwenden Ereignisdelegierung für minimalen Speicherverbrauch
- Panel werden bei Bedarf erstellt und gekacht
- Mehrere aufeinanderfolgende Klicks schließen das alte Panel automatisch

## Fehlerbehandlung

Der Handler hat integrierte Error Handling:

```javascript
try {
  window.openNpcDialog(npcId, npcName, faction);
} catch (error) {
  console.error('NPC dialog error:', error);
  // Fallback-Verhalten...
}
```
