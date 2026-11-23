// ============================================================
// 自定义视频时间轴组件
// ============================================================

(function() {
  // 将秒数转换为 h:mm.ss.ss 格式（用于前端展示）
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00.00.00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds - Math.floor(seconds)) * 100);
    return `${h}:${m.toString().padStart(2, '0')}.${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  }

  // 将 h:mm.ss.ss 解析为秒数（用于时间轴计算）
  function parseTime(str) {
    if (!str) return 0;
    const match = str.match(/^(\d{1,2}):(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/);
    if (match) {
      const h = Number(match[1]);
      const m = Number(match[2]);
      const s = Number(match[3]);
      const ms = Number(match[4]);
      return h * 3600 + m * 60 + s + ms / 100;
    }
    return 0;
  }

  // 将 h:mm.ss.ss 转换为后端认识的 HH:MM:SS 格式
  function toBackendFormat(str) {
    const seconds = parseTime(str);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  class TimelineEditor {
    constructor(options) {
      this.container = options.container;
      this.video = options.video;
      this.inputStart = options.inputStart;
      this.inputEnd = options.inputEnd;
      this.duration = 0;
      
      this.startTime = 0;
      this.endTime = 0;
      this.playheadTime = 0;

      this.isDragging = false;
      this.dragType = null;

      this.initDOM();
      this.bindEvents();
    }

    initDOM() {
      this.container.innerHTML = `
        <div class="tl-wrapper">
          <div class="tl-controls flex justify-between items-center mb-16">
            <div class="flex gap-8 items-center">
              <span class="text-muted" style="font-size:13px;">今日剩余：</span>
              <span id="tlQuota" style="color:var(--color-coral); font-weight:bold; font-size: 14px;">- / -</span>
            </div>
            <div class="flex gap-8">
              <button class="btn" id="btnSetStart" type="button" style="font-weight: 700;">打入点</button>
              <button class="btn" id="btnSetEnd" type="button" style="font-weight: 700;">打出点</button>
              <div style="width: 1px; height: 24px; background: var(--border-color); margin: 0 8px;"></div>
              <button class="btn btn-primary" id="btnClip" type="button" style="display:none;" style="font-weight: 700;">提交切片</button>
              <a class="btn" id="btnDownload" href="#" target="_blank" style="display:none; background: var(--color-mint); color: #fff; border: none; text-decoration: none !important;" style="font-weight: 700;">下载切片</a>
            </div>
          </div>
          <div class="tl-track-container" id="tlTrack">
            <div class="tl-selection" id="tlSelection"></div>
            <div class="tl-playhead" id="tlPlayhead"></div>
            <div class="tl-handle tl-handle-left" id="handleLeft"></div>
            <div class="tl-handle tl-handle-right" id="handleRight"></div>
          </div>
          <div class="tl-ruler flex justify-between text-muted mt-8" style="font-size: 12px;">
            <span>0:00</span>
            <span id="tlRulerHalf">0:00</span>
            <span id="tlRulerEnd">0:00</span>
          </div>
        </div>
      `;

      this.track = document.getElementById('tlTrack');
      this.selection = document.getElementById('tlSelection');
      this.playhead = document.getElementById('tlPlayhead');
      this.handleLeft = document.getElementById('handleLeft');
      this.handleRight = document.getElementById('handleRight');
      this.rulerHalf = document.getElementById('tlRulerHalf');
      this.rulerEnd = document.getElementById('tlRulerEnd');
      
      // 对外暴露这些按钮，方便外部调用
      this.btnClip = document.getElementById('btnClip');
      this.btnDownload = document.getElementById('btnDownload');
      this.statQuota = document.getElementById('tlQuota');
    }
    
    bindEvents() {
      this.video.addEventListener('loadedmetadata', () => {
        this.duration = this.video.duration;
        this.endTime = this.duration;
        this.updateUI();
        this.updateInputs();
      });

      this.video.addEventListener('timeupdate', () => {
        if (!this.isDragging) {
          this.playheadTime = this.video.currentTime;
          this.updatePlayheadPosition();
        }
      });

      this.inputStart.addEventListener('change', () => {
        let sec = parseTime(this.inputStart.value);
        if (sec >= 0 && sec < this.endTime) {
          this.startTime = sec;
          this.updateUI();
          this.video.currentTime = sec;
        } else {
          this.updateInputs();
        }
      });

      this.inputEnd.addEventListener('change', () => {
        let sec = parseTime(this.inputEnd.value);
        if (sec > this.startTime && sec <= this.duration) {
          this.endTime = sec;
          this.updateUI();
        } else {
          this.updateInputs();
        }
      });

      document.getElementById('btnSetStart').addEventListener('click', () => {
        if (this.playheadTime < this.endTime) {
          this.startTime = this.playheadTime;
          this.updateUI();
          this.updateInputs();
        }
      });

      document.getElementById('btnSetEnd').addEventListener('click', () => {
        if (this.playheadTime > this.startTime) {
          this.endTime = this.playheadTime;
          this.updateUI();
          this.updateInputs();
        }
      });

      const startDrag = (type, e) => {
        this.isDragging = true;
        this.dragType = type;
        document.body.style.cursor = type === 'playhead' ? 'pointer' : 'ew-resize';
        e.preventDefault();
      };

      this.handleLeft.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        startDrag('start', e);
        });
      this.handleRight.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        startDrag('end', e);
      });

      this.track.addEventListener('mousedown', (e) => {
        startDrag('playhead', e);
        this.handleDrag(e);
      });

      window.addEventListener('mousemove', (e) => {
        if (this.isDragging) this.handleDrag(e);
      });

      window.addEventListener('mouseup', () => {
        if (this.isDragging) {
          this.isDragging = false;
          this.dragType = null;
          document.body.style.cursor = 'default';
          this.updateInputs();
        }
      });
    }

    handleDrag(e) {
      const rect = this.track.getBoundingClientRect();
      let x = e.clientX - rect.left;
      x = Math.max(0, Math.min(x, rect.width));
      const time = (x / rect.width) * this.duration;

      if (this.dragType === 'start') {
        this.startTime = Math.min(time, this.endTime - 1);
        this.video.currentTime = this.startTime;
      } else if (this.dragType === 'end') {
        this.endTime = Math.max(time, this.startTime + 1);
      } else if (this.dragType === 'playhead') {
        this.playheadTime = time;
        this.video.currentTime = time;
      }
      
      this.updateUI();
    }

    updateUI() {
      if (!this.duration) return;

      const startPercent = (this.startTime / this.duration) * 100;
      const endPercent = (this.endTime / this.duration) * 100;
      
      this.selection.style.left = `${startPercent}%`;
      this.selection.style.width = `${endPercent - startPercent}%`;
      
      this.handleLeft.style.left = `${startPercent}%`;
      this.handleRight.style.left = `${endPercent}%`;

      this.rulerHalf.textContent = formatTime(this.duration / 2).substring(2, 10);
      this.rulerEnd.textContent = formatTime(this.duration).substring(2, 10);

      this.updatePlayheadPosition();
    }

    updatePlayheadPosition() {
      if (!this.duration) return;
      const playheadPercent = (this.playheadTime / this.duration) * 100;
      this.playhead.style.left = `${playheadPercent}%`;
    }

    updateInputs() {
      this.inputStart.value = formatTime(this.startTime);
      this.inputEnd.value = formatTime(this.endTime);
    }
  }

  window.TimelineEditor = TimelineEditor;
  window.toBackendFormat = toBackendFormat; // 暴露到全局
})();