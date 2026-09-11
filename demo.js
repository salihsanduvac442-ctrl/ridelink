(function () {
  const NICK_WORDS = ['Şahin', 'Kartal', 'Yıldırım', 'Kasırga', 'Rüzgar', 'Çelik', 'Kaplan', 'Bora'];
  const myName = NICK_WORDS[Math.floor(Math.random() * NICK_WORDS.length)] + '-' + Math.floor(Math.random() * 90 + 10);

  const el = (id) => document.getElementById(id);
  const joinRow = el('joinRow');
  const roomCodeInput = el('roomCode');
  const joinBtn = el('joinBtn');
  const statusArea = el('statusArea');
  const statusPill = el('statusPill');
  const statusText = el('statusText');
  const membersPanel = el('membersPanel');
  const memberList = el('memberList');
  const alertPanel = el('alertPanel');
  const alertBanner = el('alertBanner');
  const muteBtn = el('muteBtn');
  const sosBtn = el('sosBtn');
  const leaveBtn = el('leaveBtn');
  const mapPanel = el('mapPanel');
  const logPanel = el('logPanel');
  const logBox = el('logBox');

  let myPeer = null;
  let dirPeer = null;
  let isHost = false;
  let hostMembers = new Map(); // id -> { name, conn }
  let hostConn = null; // member's connection to the directory/host
  let localStream = null;
  let muted = false;
  const remoteAudioEls = new Map(); // id -> audio element
  const knownMembers = new Set();

  function log(msg) {
    logPanel.style.display = 'block';
    const line = document.createElement('div');
    const t = new Date().toLocaleTimeString();
    line.textContent = '[' + t + '] ' + msg;
    logBox.appendChild(line);
    logBox.scrollTop = logBox.scrollHeight;
  }

  function setStatus(mode, text) {
    statusArea.style.display = 'block';
    statusText.textContent = text;
    statusPill.classList.toggle('live', mode === 'live');
  }

  function addMember(id, name, isSelf) {
    if (knownMembers.has(id)) return;
    knownMembers.add(id);
    membersPanel.style.display = 'block';
    const row = document.createElement('div');
    row.className = 'member';
    row.id = 'member-' + id;
    row.innerHTML = '<span class="name">' + name + (isSelf ? ' (sen)' : '') + '</span><span class="tag">🔊 bağlı</span>';
    memberList.appendChild(row);
    log(name + ' gruba katıldı');
  }

  function removeMember(id) {
    knownMembers.delete(id);
    const row = document.getElementById('member-' + id);
    if (row) row.remove();
    const audioEl = remoteAudioEls.get(id);
    if (audioEl) {
      audioEl.remove();
      remoteAudioEls.delete(id);
    }
    log('Bir üye gruptan ayrıldı');
  }

  function addRemoteAudio(id, stream) {
    if (remoteAudioEls.has(id)) return;
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.srcObject = stream;
    audioEl.dataset.peer = id;
    document.body.appendChild(audioEl);
    remoteAudioEls.set(id, audioEl);
    log('Sesli bağlantı kuruldu: ' + id.slice(0, 8));
  }

  function callPeer(id) {
    if (!myPeer || id === myPeer.id) return;
    const call = myPeer.call(id, localStream);
    call.on('stream', (remoteStream) => addRemoteAudio(id, remoteStream));
    call.on('error', (e) => log('Arama hatası: ' + e));
  }

  function broadcastFromHost(msg, excludeId) {
    hostMembers.forEach((info, id) => {
      if (id !== excludeId && info.conn) {
        try { info.conn.send(msg); } catch (e) {}
      }
    });
  }

  function showSOS(name) {
    alertBanner.textContent = '🚨 Kaza bildirimi: ' + name + ' — grup üyeleri bilgilendirildi (demo).';
    alertBanner.classList.add('show');
    log('KAZA BİLDİRİMİ: ' + name);
  }

  function listenHostConnections() {
    dirPeer.on('connection', (conn) => {
      conn.on('data', (data) => {
        if (data.type === 'register') {
          const list = Array.from(hostMembers.entries()).map(([id, info]) => ({ id, name: info.name }));
          conn.send({ type: 'members', list });
          hostMembers.set(data.id, { name: data.name, conn });
          addMember(data.id, data.name, false);
          broadcastFromHost({ type: 'new-member', id: data.id, name: data.name }, data.id);
        } else if (data.type === 'sos') {
          showSOS(data.name);
          broadcastFromHost({ type: 'sos', name: data.name }, data.id);
        } else if (data.type === 'leave') {
          hostMembers.delete(data.id);
          removeMember(data.id);
          broadcastFromHost({ type: 'left', id: data.id }, data.id);
        }
      });
      conn.on('close', () => {
        if (hostMembers.has(conn.peer)) {
          hostMembers.delete(conn.peer);
          removeMember(conn.peer);
          broadcastFromHost({ type: 'left', id: conn.peer }, conn.peer);
        }
      });
    });
  }

  function joinAsMember(dirId) {
    hostConn = myPeer.connect(dirId, { reliable: true });
    hostConn.on('open', () => {
      hostConn.send({ type: 'register', id: myPeer.id, name: myName });
      setStatus('live', 'Gruba katıldın: ' + myName);
      addMember(myPeer.id, myName, true);
      alertPanel.style.display = 'block';
      mapPanel.style.display = 'block';
      initMap();
    });
    hostConn.on('data', (data) => {
      if (data.type === 'members') {
        data.list.forEach((m) => {
          addMember(m.id, m.name, false);
          callPeer(m.id);
        });
      } else if (data.type === 'new-member') {
        addMember(data.id, data.name, false);
      } else if (data.type === 'sos') {
        showSOS(data.name);
      } else if (data.type === 'left') {
        removeMember(data.id);
      }
    });
    hostConn.on('error', () => log('Yönlendirici bağlantı hatası'));
  }

  function attemptHost(code) {
    const dirId = 'ridelink-room-' + code;
    dirPeer = new Peer(dirId);
    dirPeer.on('open', () => {
      isHost = true;
      hostMembers.set(myPeer.id, { name: myName, conn: null });
      setStatus('live', 'Grup kuruldu — sen host: ' + myName);
      addMember(myPeer.id, myName, true);
      alertPanel.style.display = 'block';
      mapPanel.style.display = 'block';
      initMap();
      listenHostConnections();
      log('Grup ' + code + ' oluşturuldu, üyeler bekleniyor…');
    });
    dirPeer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        joinAsMember(dirId);
      } else {
        log('Yönlendirici hata: ' + err.type);
      }
    });
  }

  function joinRoom(code) {
    if (typeof Peer === 'undefined') {
      setStatus('error', 'Bağlantı kütüphanesi yüklenemedi — internet bağlantınızı kontrol edin.');
      log('PeerJS kütüphanesi yüklenemedi (CDN erişilemedi).');
      return;
    }
    setStatus('connecting', 'Mikrofon izni isteniyor…');
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then((stream) => {
        localStream = stream;
        joinRow.style.display = 'none';
        setStatus('connecting', 'Gruba bağlanılıyor…');
        try {
          myPeer = new Peer();
        } catch (e) {
          setStatus('error', 'Bağlantı kurulamadı — lütfen tekrar deneyin.');
          log('Peer oluşturma hatası: ' + e.message);
          return;
        }
        myPeer.on('open', () => attemptHost(code));
        myPeer.on('call', (call) => {
          call.answer(localStream);
          call.on('stream', (remoteStream) => addRemoteAudio(call.peer, remoteStream));
        });
        myPeer.on('error', (err) => log('Peer hatası: ' + err.type));
      })
      .catch((err) => {
        setStatus('error', 'Mikrofon izni verilmedi — sesli katılamazsın.');
        log('Mikrofon hatası: ' + err.message);
      });
  }

  function initMap() {
    const mapEl = document.getElementById('map');
    if (mapEl.dataset.inited) return;
    mapEl.dataset.inited = '1';
    if (typeof L === 'undefined') {
      mapEl.textContent = 'Harita kütüphanesi yüklenemedi (internet bağlantısı gerekli).';
      return;
    }
    const map = L.map('map').setView([41.0082, 28.9784], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 18
    }).addTo(map);
    const marker = L.marker([41.0082, 28.9784]).addTo(map).bindPopup('Konum bekleniyor…');

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const latlng = [pos.coords.latitude, pos.coords.longitude];
          map.setView(latlng, 14);
          marker.setLatLng(latlng).bindPopup(myName + ' (sen)').openPopup();
        },
        () => {
          marker.bindPopup('Konum izni verilmedi — örnek konum gösteriliyor').openPopup();
        },
        { timeout: 8000 }
      );
    }
  }

  joinBtn.addEventListener('click', () => {
    const raw = roomCodeInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!raw) {
      roomCodeInput.focus();
      return;
    }
    joinRoom(raw);
  });

  roomCodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinBtn.click();
  });

  muteBtn.addEventListener('click', () => {
    if (!localStream) return;
    muted = !muted;
    localStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
    muteBtn.textContent = muted ? '🔇 Sesi Aç' : '🎙️ Sesi Kapat';
    muteBtn.classList.toggle('muted', muted);
  });

  sosBtn.addEventListener('click', () => {
    showSOS(myName + ' (sen)');
    if (isHost) {
      broadcastFromHost({ type: 'sos', name: myName }, null);
    } else if (hostConn) {
      hostConn.send({ type: 'sos', name: myName });
    }
  });

  leaveBtn.addEventListener('click', () => {
    if (hostConn) {
      try { hostConn.send({ type: 'leave', id: myPeer.id }); } catch (e) {}
    }
    if (myPeer) myPeer.destroy();
    if (dirPeer) dirPeer.destroy();
    window.location.reload();
  });
})();
