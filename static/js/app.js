const greenIcon = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png', iconSize: [25, 41], iconAnchor: [12, 41] });
const redIcon = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', iconSize: [25, 41], iconAnchor: [12, 41] });
const cabIcon = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png', iconSize: [25, 41], iconAnchor: [12, 41] });

function initMap(center = [40.7128, -74.0060], zoom = 13) {
    const map = L.map('map').setView(center, zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => map.setView([pos.coords.latitude, pos.coords.longitude], 14), () => {});
    }
    return map;
}

async function getAddressFromCoords(lat, lng) {
    try {
        const res = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`);
        const data = await res.json();
        return data.display_name ? data.display_name.split(',').slice(0, 3).join(',') : `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch {
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
}

function setupPassengerMap() {
    const map = initMap();
    let pMarker, dMarker, cabMarker, rLine, pCoords, dCoords, rideId, timer, ratingSubmitted = false;

    function resetPassengerState() {
        if (pMarker) map.removeLayer(pMarker); if (dMarker) map.removeLayer(dMarker);
        if (cabMarker) map.removeLayer(cabMarker); if (rLine) map.removeLayer(rLine);
        pMarker = dMarker = cabMarker = rLine = pCoords = dCoords = rideId = null;
        ratingSubmitted = false; if (timer) clearInterval(timer);
        document.getElementById('pAddr').value = ''; document.getElementById('dAddr').value = '';
        document.getElementById('dist').innerText = '0.0 km'; document.getElementById('fare').innerText = '$0.00';
        document.getElementById('bookBtn').disabled = true;
        document.getElementById('statusCard').style.display = 'none';
        document.getElementById('ratingCard').style.display = 'none';
        document.getElementById('hint').innerHTML = '💡 Search address or click map for <b>Pickup</b>.';
    }

    function updateRouteInfo() {
        if (pCoords && dCoords) {
            if (rLine) map.removeLayer(rLine);
            rLine = L.polyline([pCoords, dCoords], {color: '#38bdf8', weight: 4, dashArray: '8,8'}).addTo(map);
            map.fitBounds(rLine.getBounds(), {padding: [40, 40]});
            const dist = (map.distance(pCoords, dCoords)/1000).toFixed(2);
            document.getElementById('dist').innerText = `${dist} km`;
            document.getElementById('fare').innerText = `$${(3 + dist*1.8).toFixed(2)}`;
            document.getElementById('bookBtn').disabled = false;
        }
    }

    map.on('click', async (e) => {
        if (rideId) return;
        if (!pCoords) {
            pCoords = e.latlng; pMarker = L.marker(pCoords, {icon: greenIcon}).addTo(map).bindPopup("Pickup").openPopup();
            document.getElementById('pAddr').value = await getAddressFromCoords(pCoords.lat, pCoords.lng);
            document.getElementById('hint').innerHTML = "💡 Click map for <b>Drop-off</b>.";
        } else if (!dCoords) {
            dCoords = e.latlng; dMarker = L.marker(dCoords, {icon: redIcon}).addTo(map).bindPopup("Destination").openPopup();
            document.getElementById('dAddr').value = await getAddressFromCoords(dCoords.lat, dCoords.lng);
            updateRouteInfo();
        }
    });

    setupAutocomplete('pAddr', 'pSuggestions', (lat, lng, name) => {
        if (rideId) return; pCoords = {lat, lng};
        if (pMarker) map.removeLayer(pMarker); pMarker = L.marker(pCoords, {icon: greenIcon}).addTo(map).bindPopup(name).openPopup();
        map.setView([lat, lng], 14); if (dCoords) updateRouteInfo();
    });

    setupAutocomplete('dAddr', 'dSuggestions', (lat, lng, name) => {
        if (rideId) return; dCoords = {lat, lng};
        if (dMarker) map.removeLayer(dMarker); dMarker = L.marker(dCoords, {icon: redIcon}).addTo(map).bindPopup(name).openPopup();
        if (pCoords) updateRouteInfo();
    });

    window.requestRide = async () => {
        const res = await fetch('/api/request-ride', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ pickup_address: document.getElementById('pAddr').value, pickup_lat: pCoords.lat, pickup_lng: pCoords.lng, dropoff_address: document.getElementById('dAddr').value, dropoff_lat: dCoords.lat, dropoff_lng: dCoords.lng })
        });
        const data = await res.json();
        if (data.success) {
            rideId = data.ride_id;
            document.getElementById('bookBtn').disabled = true;
            document.getElementById('statusCard').style.display = 'block';
            document.getElementById('otpVal').innerText = data.otp;
            document.getElementById('cancelBtn').style.display = 'inline-block';
            timer = setInterval(async () => {
                const r = await (await fetch(`/api/ride-status/${rideId}`)).json();
                document.getElementById('badge').innerText = r.status.toUpperCase();
                document.getElementById('badge').className = `status-badge badge-${r.status}`;
                if (r.driver_lat && r.driver_lng) {
                    if (!cabMarker) cabMarker = L.marker([r.driver_lat, r.driver_lng], {icon: cabIcon}).addTo(map).bindPopup(`Driver ${r.driver_name}`);
                    else cabMarker.setLatLng([r.driver_lat, r.driver_lng]);
                }
                if (r.status === 'accepted') document.getElementById('cancelBtn').style.display = 'none';
                if (r.status === 'completed' && !ratingSubmitted) {
                    clearInterval(timer);
                    document.getElementById('statusCard').style.display = 'none';
                    document.getElementById('ratingCard').style.display = 'block';
                    loadPassengerHistory();
                } else if (r.status === 'cancelled') { clearInterval(timer); resetPassengerState(); loadPassengerHistory(); }
            }, 2000);
        }
    };

    window.cancelRide = async () => {
        if (rideId && confirm("Cancel ride?")) {
            await fetch(`/api/cancel-ride/${rideId}`, {method: 'POST'});
            resetPassengerState(); loadPassengerHistory();
        }
    };

    window.submitRating = async (stars) => {
        if (rideId) {
            await fetch(`/api/submit-rating/${rideId}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ rating: stars }) });
            ratingSubmitted = true;
            document.getElementById('ratingCard').innerHTML = '<div style="text-align:center;"><small style="color:#10b981;">Rated! ⭐</small><br><button onclick="resetPassengerState()" style="padding:0.2rem 0.5rem; font-size:0.8rem; margin-top:0.4rem;">Book New Ride</button></div>';
            loadPassengerHistory();
        }
    };

    window.resetPassengerState = resetPassengerState;

    async function loadPassengerHistory() {
        const data = await (await fetch('/api/user-history')).json();
        const box = document.getElementById('historyBox');
        if (box) {
            box.innerHTML = data.history.length ? data.history.slice(0, 5).map(h => `
                <div style="font-size:0.8rem; border-bottom:1px solid rgba(255,255,255,0.05); padding:0.4rem 0;">
                    <strong>#${h.id}</strong> - <span class="status-badge badge-${h.status}">${h.status}</span>
                    <div>$${h.fare.toFixed(2)} ${h.rating ? `| ⭐${h.rating}/5` : ''}</div>
                </div>
            `).join('') : '<small>No past trips.</small>';
        }
    }
    loadPassengerHistory();
}

function setupDriverMap() {
    const map = initMap();
    let activeRide, pMark, dMark, cMark, line, simTimer;

    async function loadQueue() {
        if (activeRide) return;
        const rides = await (await fetch('/api/pending-rides')).json();
        const list = document.getElementById('qList');
        list.innerHTML = rides.length ? rides.map(r => `
            <article style="padding:0.75rem; margin-bottom:0.5rem;">
                <div style="display:flex; justify-content:space-between;"><strong>${r.passenger_name}</strong> <span style="color:var(--pico-primary);">$${r.fare.toFixed(2)}</span></div>
                <small>📍 ${r.pickup_address}<br>🏁 ${r.dropoff_address}</small>
                <button onclick="acceptJob(${r.id})" style="padding:0.3rem; margin-top:0.4rem; font-size:0.8rem;">Accept Job</button>
            </article>`).join('') : '<small>No pending rides...</small>';
    }

    async function loadDriverStats() {
        const data = await (await fetch('/api/user-history')).json();
        if (document.getElementById('totalEarned')) {
            document.getElementById('totalEarned').innerText = `$${data.earnings.toFixed(2)}`;
            document.getElementById('tripCount').innerText = data.history.filter(h => h.status === 'completed').length;
            document.getElementById('avgRating').innerText = `⭐ ${data.rating}/5.0`;
        }
    }

    window.acceptJob = async (id) => {
        if ((await (await fetch(`/api/accept-ride/${id}`, {method:'POST'})).json()).success) {
            activeRide = await (await fetch(`/api/ride-status/${id}`)).json();
            document.getElementById('simArea').style.display = 'block';
            document.getElementById('otpArea').style.display = 'block';
            document.getElementById('simBtn').style.display = 'none';
            document.getElementById('qList').innerHTML = '<span style="color:#10b981;">Job Accepted! Ask passenger for OTP.</span>';
            pMark = L.marker([activeRide.pickup_lat, activeRide.pickup_lng], {icon: greenIcon}).addTo(map);
            dMark = L.marker([activeRide.dropoff_lat, activeRide.dropoff_lng], {icon: redIcon}).addTo(map);
            cMark = L.marker([activeRide.driver_lat, activeRide.driver_lng], {icon: cabIcon}).addTo(map);
            line = L.polyline([[activeRide.driver_lat, activeRide.driver_lng], [activeRide.pickup_lat, activeRide.pickup_lng], [activeRide.dropoff_lat, activeRide.dropoff_lng]], {color:'#10b981'}).addTo(map);
            map.fitBounds(line.getBounds(), {padding: [40, 40]});
        }
    };

    window.startVerifiedTrip = async () => {
        const otpIn = document.getElementById('otpInput').value;
        const res = await fetch(`/api/verify-otp/${activeRide.id}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ otp: otpIn }) });
        if ((await res.json()).success) {
            document.getElementById('otpArea').style.display = 'none';
            document.getElementById('simBtn').style.display = 'block';
            document.getElementById('simMsg').innerText = "OTP Verified! Ready to simulate route.";
        } else { alert("Incorrect OTP!"); }
    };

    window.runSim = () => {
        document.getElementById('simBtn').disabled = true;
        let step = 0, max = 20;
        const sLat = activeRide.driver_lat, sLng = activeRide.driver_lng, eLat = activeRide.dropoff_lat, eLng = activeRide.dropoff_lng;
        simTimer = setInterval(async () => {
            step++;
            const pct = step / max;
            const curLat = sLat + (eLat - sLat) * pct, curLng = sLng + (eLng - sLng) * pct;
            cMark.setLatLng([curLat, curLng]);
            let st = pct >= 1 ? 'completed' : 'in_progress';
            await fetch(`/api/update-progress/${activeRide.id}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({status: st, driver_lat: curLat, driver_lng: curLng}) });
            if (pct >= 1) {
                clearInterval(simTimer);
                activeRide = null;
                document.getElementById('simArea').style.display = 'none';
                if (pMark) map.removeLayer(pMark); if (dMark) map.removeLayer(dMark);
                if (cMark) map.removeLayer(cMark); if (line) map.removeLayer(line);
                loadDriverStats(); loadQueue();
            }
        }, 1000);
    };

    window.resetDemo = async () => { if(confirm("Reset all rides?")) { await fetch('/api/reset-demo', {method:'POST'}); location.reload(); }};
    setInterval(loadQueue, 2500); loadQueue(); loadDriverStats();
}

function setupAutocomplete(inputId, dropdownId, onSelect) {
    const input = document.getElementById(inputId), dropdown = document.getElementById(dropdownId);
    if (!input || !dropdown) return;
    let timer;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        if (input.value.trim().length < 3) { dropdown.style.display = 'none'; return; }
        timer = setTimeout(async () => {
            const items = await (await fetch(`/api/geocode?q=${encodeURIComponent(input.value.trim())}`)).json();
            if (items && items.length) {
                dropdown.innerHTML = items.map(item => `<div class="suggestion-item" data-lat="${item.lat}" data-lng="${item.lon}" data-name="${item.display_name}">${item.display_name}</div>`).join('');
                dropdown.style.display = 'block';
                dropdown.querySelectorAll('.suggestion-item').forEach(el => {
                    el.onclick = () => {
                        input.value = el.getAttribute('data-name').split(',').slice(0, 3).join(',');
                        dropdown.style.display = 'none';
                        onSelect(parseFloat(el.getAttribute('data-lat')), parseFloat(el.getAttribute('data-lng')), input.value);
                    };
                });
            } else dropdown.style.display = 'none';
        }, 350);
    });
    document.addEventListener('click', (e) => { if (!input.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display = 'none'; });
}
