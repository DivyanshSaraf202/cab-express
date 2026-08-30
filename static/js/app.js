const $ = id => document.getElementById(id);

const greenIcon = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png', iconSize: [25, 41], iconAnchor: [12, 41] });
const redIcon = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', iconSize: [25, 41], iconAnchor: [12, 41] });
const cabIcon = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png', iconSize: [25, 41], iconAnchor: [12, 41] });


function initMap(center = [40.7128, -74.0060], zoom = 13) {
    const map = L.map('map').setView(center, zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => map.setView([pos.coords.latitude, pos.coords.longitude], 14), () => {});
    }

    setTimeout(() => map.invalidateSize(), 300);
    setTimeout(() => map.invalidateSize(), 1000);
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
        if (pMarker) map.removeLayer(pMarker);
        if (dMarker) map.removeLayer(dMarker);
        if (cabMarker) map.removeLayer(cabMarker);
        if (rLine) map.removeLayer(rLine);

        pMarker = dMarker = cabMarker = rLine = pCoords = dCoords = rideId = null;
        ratingSubmitted = false;
        if (timer) clearInterval(timer);

        $('pickupAddress').value = '';
        $('dropoffAddress').value = '';
        $('distanceValue').innerText = '0.0 km';
        $('fareValue').innerText = '$0.00';
        $('bookRideBtn').disabled = true;
        $('statusCard').style.display = 'none';
        $('ratingCard').style.display = 'none';
        $('instructionHint').innerHTML = 'Search location or click map to select <strong>Pickup</strong>.';
    }

    function updateRouteInfo() {
        if (pCoords && dCoords) {
            if (rLine) map.removeLayer(rLine);
            rLine = L.polyline([pCoords, dCoords], { color: '#000', weight: 4, dashArray: '6,6' }).addTo(map);
            map.fitBounds(rLine.getBounds(), { padding: [40, 40] });

            const dist = (map.distance(pCoords, dCoords) / 1000).toFixed(2);
            const fare = (3.00 + (dist * 1.80)).toFixed(2);

            $('distanceValue').innerText = `${dist} km`;
            $('fareValue').innerText = `$${fare}`;
            $('bookRideBtn').disabled = false;
        }
    }

    map.on('click', async (e) => {
        if (rideId) return;

        if (!pCoords) {
            pCoords = e.latlng;
            pMarker = L.marker(pCoords, { icon: greenIcon }).addTo(map).bindPopup("Pickup Location").openPopup();
            $('pickupAddress').value = await getAddressFromCoords(pCoords.lat, pCoords.lng);
            $('instructionHint').innerHTML = "Click map to select <strong>Drop-off destination</strong>.";
        } else if (!dCoords) {
            dCoords = e.latlng;
            dMarker = L.marker(dCoords, { icon: redIcon }).addTo(map).bindPopup("Destination").openPopup();
            $('dropoffAddress').value = await getAddressFromCoords(dCoords.lat, dCoords.lng);
            updateRouteInfo();
        }
    });

    setupAutocomplete('pickupAddress', 'pickupSuggestions', (lat, lng, name) => {
        if (rideId) return;
        pCoords = { lat, lng };
        if (pMarker) map.removeLayer(pMarker);
        pMarker = L.marker(pCoords, { icon: greenIcon }).addTo(map).bindPopup(name).openPopup();
        map.setView([lat, lng], 14);
        if (dCoords) updateRouteInfo();
    });

    setupAutocomplete('dropoffAddress', 'dropoffSuggestions', (lat, lng, name) => {
        if (rideId) return;
        dCoords = { lat, lng };
        if (dMarker) map.removeLayer(dMarker);
        dMarker = L.marker(dCoords, { icon: redIcon }).addTo(map).bindPopup(name).openPopup();
        if (pCoords) updateRouteInfo();
    });

    window.requestRide = async () => {
        if (!pCoords || !dCoords) return;

        const res = await fetch('/api/request-ride', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pickup_address: $('pickupAddress').value, pickup_lat: pCoords.lat, pickup_lng: pCoords.lng,
                dropoff_address: $('dropoffAddress').value, dropoff_lat: dCoords.lat, dropoff_lng: dCoords.lng
            })
        });

        const data = await res.json();
        if (data.success) {
            rideId = data.ride_id;
            $('bookRideBtn').disabled = true;
            $('statusCard').style.display = 'block';
            $('otpValue').innerText = data.otp;
            $('cancelRideBtn').style.display = 'block';

            timer = setInterval(async () => {
                const r = await (await fetch(`/api/ride-status/${rideId}`)).json();
                $('statusBadge').innerText = r.status.toUpperCase();
                $('statusBadge').className = `status-badge badge-${r.status}`;

                if (r.driver_lat && r.driver_lng) {
                    if (!cabMarker) cabMarker = L.marker([r.driver_lat, r.driver_lng], { icon: cabIcon }).addTo(map).bindPopup(`Driver: ${r.driver_name}`);
                    else cabMarker.setLatLng([r.driver_lat, r.driver_lng]);
                }

                if (r.status === 'accepted') $('cancelRideBtn').style.display = 'none';

                if (r.status === 'completed' && !ratingSubmitted) {
                    clearInterval(timer);
                    $('statusCard').style.display = 'none';
                    $('ratingCard').style.display = 'block';
                    loadPassengerHistory();
                } else if (r.status === 'cancelled') {
                    clearInterval(timer);
                    resetPassengerState();
                    loadPassengerHistory();
                }
            }, 2000);
        }
    };

    window.cancelRide = async () => {
        if (rideId && confirm("Cancel this ride request?")) {
            await fetch(`/api/cancel-ride/${rideId}`, { method: 'POST' });
            resetPassengerState();
            loadPassengerHistory();
        }
    };

    window.submitRating = async (stars) => {
        if (rideId) {
            await fetch(`/api/submit-rating/${rideId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rating: stars })
            });

            ratingSubmitted = true;
            $('ratingCard').innerHTML = `
                <div style="text-align: center; padding: 0.4rem;">
                    <strong style="color: #059669;">Thank you for your rating!</strong><br>
                    <button type="button" onclick="resetPassengerState()" class="btn btn-secondary" style="margin-top: 0.4rem; font-size: 0.8rem;">Book Another Ride</button>
                </div>`;
            loadPassengerHistory();
        }
    };

    async function loadPassengerHistory() {
        const data = await (await fetch('/api/user-history')).json();
        const box = $('historyContainer');
        if (box) {
            box.innerHTML = data.history.length ? `
                <table class="table">
                    <thead><tr><th>Trip</th><th>Status</th><th>Fare</th><th>Rating</th></tr></thead>
                    <tbody>${data.history.slice(0, 5).map(h => `
                        <tr>
                            <td><strong>#${h.id}</strong></td>
                            <td><span class="status-badge badge-${h.status}">${h.status}</span></td>
                            <td>$${h.fare.toFixed(2)}</td>
                            <td>${h.rating ? `${h.rating} ★` : '-'}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>` : '<small style="color: var(--text-muted);">No past trips found.</small>';
        }
    }

    window.resetPassengerState = resetPassengerState;
    loadPassengerHistory();
}


function setupDriverMap() {
    const map = initMap();
    let activeRide, pMark, dMark, cMark, line, simTimer;

    async function loadQueue() {
        if (activeRide) return;
        const rides = await (await fetch('/api/pending-rides')).json();
        const box = $('queueContainer');

        box.innerHTML = rides.length ? rides.map(r => `
            <div style="border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; margin-bottom: 0.5rem;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.2rem;">
                    <strong>Passenger: ${r.passenger_name}</strong>
                    <span style="font-weight: 700; color: #0284c7;">$${r.fare.toFixed(2)}</span>
                </div>
                <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.35rem;">
                    <div><strong>From:</strong> ${r.pickup_address}</div>
                    <div><strong>To:</strong> ${r.dropoff_address}</div>
                </div>
                <button type="button" onclick="acceptJob(${r.id})" class="btn btn-primary btn-block" style="padding: 0.3rem; font-size: 0.8rem;">Accept Job</button>
            </div>`).join('') : '<small style="color: var(--text-muted);">No pending job requests...</small>';
    }

    async function loadDriverStats() {
        const data = await (await fetch('/api/user-history')).json();
        if ($('totalEarned')) {
            $('totalEarned').innerText = `$${data.earnings.toFixed(2)}`;
            $('tripCount').innerText = data.history.filter(h => h.status === 'completed').length;
            $('avgRating').innerText = `${data.rating} ★`;
        }
    }

    window.acceptJob = async (id) => {
        if ((await (await fetch(`/api/accept-ride/${id}`, { method: 'POST' })).json()).success) {
            activeRide = await (await fetch(`/api/ride-status/${id}`)).json();

            $('simulationCard').style.display = 'block';
            $('otpInputSection').style.display = 'flex';
            $('startSimulationBtn').style.display = 'none';
            $('queueContainer').innerHTML = '<div class="alert alert-info">Job Accepted! Ask passenger for OTP.</div>';

            pMark = L.marker([activeRide.pickup_lat, activeRide.pickup_lng], { icon: greenIcon }).addTo(map);
            dMark = L.marker([activeRide.dropoff_lat, activeRide.dropoff_lng], { icon: redIcon }).addTo(map);
            cMark = L.marker([activeRide.driver_lat, activeRide.driver_lng], { icon: cabIcon }).addTo(map);

            line = L.polyline([[activeRide.driver_lat, activeRide.driver_lng], [activeRide.pickup_lat, activeRide.pickup_lng], [activeRide.dropoff_lat, activeRide.dropoff_lng]], { color: '#059669', weight: 4 }).addTo(map);
            map.fitBounds(line.getBounds(), { padding: [40, 40] });
        }
    };

    window.startVerifiedTrip = async () => {
        const otpIn = $('driverOtpInput').value;
        const res = await fetch(`/api/verify-otp/${activeRide.id}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ otp: otpIn })
        });

        if ((await res.json()).success) {
            activeRide = await (await fetch(`/api/ride-status/${activeRide.id}`)).json();
            $('otpInputSection').style.display = 'none';
            const btn = $('startSimulationBtn');
            btn.style.display = 'block';
            btn.disabled = false;
            $('simulationMessage').innerText = "OTP Verified! Ready to simulate route.";
        } else {
            alert("Incorrect OTP!");
        }
    };

    window.runSim = () => {
        if (!activeRide) return;
        const btn = $('startSimulationBtn');
        if (btn) btn.disabled = true;

        let step = 0, max = 20;
        const sLat = parseFloat(activeRide.driver_lat || activeRide.pickup_lat),
              sLng = parseFloat(activeRide.driver_lng || activeRide.pickup_lng),
              eLat = parseFloat(activeRide.dropoff_lat),
              eLng = parseFloat(activeRide.dropoff_lng);

        simTimer = setInterval(async () => {
            step++;
            const pct = step / max;
            const curLat = sLat + (eLat - sLat) * pct, curLng = sLng + (eLng - sLng) * pct;

            if (cMark) cMark.setLatLng([curLat, curLng]);
            let st = pct >= 1 ? 'completed' : 'in_progress';

            await fetch(`/api/update-progress/${activeRide.id}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: st, driver_lat: curLat, driver_lng: curLng })
            });

            if (pct >= 1) {
                clearInterval(simTimer);
                activeRide = null;
                $('simulationCard').style.display = 'none';
                if (pMark) map.removeLayer(pMark);
                if (dMark) map.removeLayer(dMark);
                if (cMark) map.removeLayer(cMark);
                if (line) map.removeLayer(line);
                loadDriverStats();
                loadQueue();
            }
        }, 1000);
    };

    window.resetDemoData = async () => {
        if (confirm("Reset all test rides?")) {
            await fetch('/api/reset-demo', { method: 'POST' });
            location.reload();
        }
    };

    setInterval(loadQueue, 2500);
    loadQueue();
    loadDriverStats();
}


function setupAutocomplete(inputId, dropdownId, onSelect) {
    const input = $(inputId), dropdown = $(dropdownId);
    if (!input || !dropdown) return;
    let timer;

    input.addEventListener('input', () => {
        clearTimeout(timer);
        if (input.value.trim().length < 3) { dropdown.style.display = 'none'; return; }

        timer = setTimeout(async () => {
            const items = await (await fetch(`/api/geocode?q=${encodeURIComponent(input.value.trim())}`)).json();
            if (items && items.length) {
                dropdown.innerHTML = items.map(i => `<div class="suggestion-item" data-lat="${i.lat}" data-lng="${i.lon}" data-name="${i.display_name}">${i.display_name}</div>`).join('');
                dropdown.style.display = 'block';

                dropdown.querySelectorAll('.suggestion-item').forEach(el => {
                    el.onclick = () => {
                        const name = el.getAttribute('data-name').split(',').slice(0, 3).join(',');
                        input.value = name;
                        dropdown.style.display = 'none';
                        onSelect(parseFloat(el.getAttribute('data-lat')), parseFloat(el.getAttribute('data-lng')), name);
                    };
                });
            } else dropdown.style.display = 'none';
        }, 350);
    });

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display = 'none';
    });
}
