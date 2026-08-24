import math, random, urllib.request, urllib.parse, json
from flask import Blueprint, render_template, redirect, url_for, request, jsonify, flash
from flask_login import login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from .database import get_db, User

routes = Blueprint('routes', __name__)

def calc_dist(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1))*math.cos(math.radians(lat2))*math.sin(dlon/2)**2
    return round(R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)), 2)

@routes.route('/')
def index():
    if current_user.is_authenticated:
        return redirect(url_for('routes.driver_dash') if current_user.role == 'driver' else url_for('routes.passenger_dash'))
    return redirect(url_for('routes.auth'))

@routes.route('/auth', methods=['GET', 'POST'])
def auth():
    if current_user.is_authenticated:
        return redirect(url_for('routes.index'))
    if request.method == 'POST':
        action = request.form.get('action')
        username = (request.form.get('username') or '').strip()
        password = request.form.get('password') or ''
        if action == 'login':
            u = User.get_by_username(username)
            if u and check_password_hash(u['password_hash'], password):
                login_user(User(u['id'], u['username'], u['email'], u['role']))
                flash('Welcome back!', 'success')
                return redirect(url_for('routes.index'))
            flash('Invalid username or password.', 'error')
        elif action == 'register':
            email = (request.form.get('email') or '').strip()
            role = request.form.get('role', 'passenger')
            try:
                with get_db() as conn:
                    conn.execute("INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)",
                                 (username, email, generate_password_hash(password), role))
                    conn.commit()
                flash('Account created! Please log in.', 'success')
            except Exception:
                flash('Username/Email taken.', 'error')
    return render_template('auth.html')

@routes.route('/logout')
@login_required
def logout():
    logout_user()
    flash('Logged out.', 'info')
    return redirect(url_for('routes.auth'))

@routes.route('/passenger')
@login_required
def passenger_dash():
    return render_template('passenger.html') if current_user.role == 'passenger' else redirect(url_for('routes.driver_dash'))

@routes.route('/driver')
@login_required
def driver_dash():
    return render_template('driver.html') if current_user.role == 'driver' else redirect(url_for('routes.passenger_dash'))

@routes.route('/api/geocode')
@login_required
def geocode():
    q, lat, lng = request.args.get('q', '').strip(), request.args.get('lat'), request.args.get('lng')
    headers = {'User-Agent': 'CabExpress/2.0'}
    try:
        url = f"https://nominatim.openstreetmap.org/search?format=json&q={urllib.parse.quote(q)}&limit=5" if q else f"https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat={lat}&lon={lng}"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=5) as res:
            return jsonify(json.loads(res.read().decode()))
    except Exception:
        return jsonify([])

@routes.route('/api/request-ride', methods=['POST'])
@login_required
def request_ride():
    if current_user.role != 'passenger': return jsonify({"error": "Unauthorized"}), 403
    d = request.json
    plat, plng, dlat, dlng = float(d['pickup_lat']), float(d['pickup_lng']), float(d['dropoff_lat']), float(d['dropoff_lng'])
    dist = calc_dist(plat, plng, dlat, dlng)
    fare, otp = round(3.00 + (dist * 1.80), 2), str(random.randint(1000, 9999))
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""INSERT INTO rides (passenger_id, passenger_name, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, fare, otp)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (current_user.id, current_user.username, d['pickup_address'], plat, plng, d['dropoff_address'], dlat, dlng, fare, otp))
        rid = cur.lastrowid
        conn.commit()
    return jsonify({"success": True, "ride_id": rid, "fare": fare, "dist": dist, "otp": otp})

@routes.route('/api/pending-rides')
@login_required
def pending_rides():
    if current_user.role != 'driver': return jsonify([])
    with get_db() as conn:
        return jsonify([dict(r) for r in conn.execute("SELECT * FROM rides WHERE status = 'pending' ORDER BY id DESC").fetchall()])

@routes.route('/api/ride-status/<int:rid>')
@login_required
def ride_status(rid):
    with get_db() as conn:
        r = conn.execute("SELECT * FROM rides WHERE id = ?", (rid,)).fetchone()
        return jsonify(dict(r)) if r else (jsonify({"error": "Not found"}), 404)

@routes.route('/api/accept-ride/<int:rid>', methods=['POST'])
@login_required
def accept_ride(rid):
    if current_user.role != 'driver': return jsonify({"error": "Unauthorized"}), 403
    with get_db() as conn:
        r = conn.execute("SELECT * FROM rides WHERE id = ?", (rid,)).fetchone()
        if r and r['status'] == 'pending':
            conn.execute("UPDATE rides SET status = 'accepted', driver_id = ?, driver_name = ?, driver_lat = ?, driver_lng = ? WHERE id = ?",
                         (current_user.id, current_user.username, r['pickup_lat'] - 0.003, r['pickup_lng'] - 0.003, rid))
            conn.commit()
            return jsonify({"success": True})
    return jsonify({"error": "Failed"}), 400

@routes.route('/api/verify-otp/<int:rid>', methods=['POST'])
@login_required
def verify_otp(rid):
    if current_user.role != 'driver': return jsonify({"error": "Unauthorized"}), 403
    with get_db() as conn:
        r = conn.execute("SELECT * FROM rides WHERE id = ?", (rid,)).fetchone()
        if r and r['otp'] == str(request.json.get('otp')).strip():
            conn.execute("UPDATE rides SET status = 'in_progress' WHERE id = ?", (rid,))
            conn.commit()
            return jsonify({"success": True})
    return jsonify({"success": False, "error": "Invalid OTP"}), 400

@routes.route('/api/submit-rating/<int:rid>', methods=['POST'])
@login_required
def submit_rating(rid):
    with get_db() as conn:
        conn.execute("UPDATE rides SET rating = ? WHERE id = ? AND passenger_id = ?", (int(request.json.get('rating', 5)), rid, current_user.id))
        conn.commit()
    return jsonify({"success": True})

@routes.route('/api/cancel-ride/<int:rid>', methods=['POST'])
@login_required
def cancel_ride(rid):
    with get_db() as conn:
        conn.execute("UPDATE rides SET status = 'cancelled' WHERE id = ? AND passenger_id = ? AND status = 'pending'", (rid, current_user.id))
        conn.commit()
    return jsonify({"success": True})

@routes.route('/api/update-progress/<int:rid>', methods=['POST'])
@login_required
def update_progress(rid):
    if current_user.role != 'driver': return jsonify({"error": "Unauthorized"}), 403
    d = request.json
    with get_db() as conn:
        conn.execute("UPDATE rides SET status = ?, driver_lat = ?, driver_lng = ? WHERE id = ? AND driver_id = ?",
                     (d.get('status', 'in_progress'), d['driver_lat'], d['driver_lng'], rid, current_user.id))
        conn.commit()
    return jsonify({"success": True})

@routes.route('/api/user-history')
@login_required
def user_history():
    with get_db() as conn:
        if current_user.role == 'driver':
            history = conn.execute("SELECT * FROM rides WHERE driver_id = ? ORDER BY id DESC", (current_user.id,)).fetchall()
            earnings = conn.execute("SELECT SUM(fare) as total FROM rides WHERE driver_id = ? AND status = 'completed'", (current_user.id,)).fetchone()['total'] or 0.0
            avg_rating = conn.execute("SELECT AVG(rating) as avg FROM rides WHERE driver_id = ? AND rating IS NOT NULL", (current_user.id,)).fetchone()['avg'] or 5.0
            return jsonify({"history": [dict(h) for h in history], "earnings": round(earnings, 2), "rating": round(avg_rating, 1)})
        else:
            history = conn.execute("SELECT * FROM rides WHERE passenger_id = ? ORDER BY id DESC", (current_user.id,)).fetchall()
            return jsonify({"history": [dict(h) for h in history]})

@routes.route('/api/reset-demo', methods=['POST'])
@login_required
def reset_demo():
    with get_db() as conn:
        conn.execute("DELETE FROM rides")
        conn.commit()
    return jsonify({"success": True})
