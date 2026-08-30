import math
import random
import urllib.request
import urllib.parse
import json
import logging

from flask import Blueprint, render_template, redirect, url_for, request, jsonify, flash
from flask_login import login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from .database import get_db, User

routes = Blueprint('routes', __name__)
logger = logging.getLogger(__name__)


def calculate_distance(lat1, lon1, lat2, lon2):
    """Calculate distance in km between two GPS points using Haversine formula."""
    earth_radius_km = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)

    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(earth_radius_km * c, 2)


@routes.route('/')
def index():
    """Route user to dashboard depending on authentication and role."""
    if current_user.is_authenticated:
        if current_user.role == 'driver':
            return redirect(url_for('routes.driver_dash'))
        return redirect(url_for('routes.passenger_dash'))
    return redirect(url_for('routes.auth'))


@routes.route('/auth', methods=['GET', 'POST'])
def auth():
    """Handle authentication login and account registration."""
    if current_user.is_authenticated:
        return redirect(url_for('routes.index'))

    if request.method == 'POST':
        action = request.form.get('action')
        username = (request.form.get('username') or '').strip()
        password = request.form.get('password') or ''

        if action == 'login':
            user_data = User.get_by_username(username)
            if user_data and check_password_hash(user_data['password_hash'], password):
                user_obj = User(user_data['id'], user_data['username'], user_data['email'], user_data['role'])
                login_user(user_obj)
                flash('Welcome back to CabExpress!', 'success')
                return redirect(url_for('routes.index'))
            flash('Invalid username or password.', 'error')

        elif action == 'register':
            email = (request.form.get('email') or '').strip()
            role = request.form.get('role', 'passenger')
            try:
                hashed_pw = generate_password_hash(password)
                with get_db() as conn:
                    conn.execute(
                        "INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)",
                        (username, email, hashed_pw, role)
                    )
                    conn.commit()
                flash('Account created successfully! Please log in.', 'success')
            except Exception as err:
                logger.error(f"Registration error: {err}")
                flash('Username or email is already taken.', 'error')

    return render_template('auth.html')


@routes.route('/logout')
@login_required
def logout():
    """Log out current user."""
    logout_user()
    flash('You have been logged out.', 'info')
    return redirect(url_for('routes.auth'))


@routes.route('/passenger')
@login_required
def passenger_dash():
    """Passenger booking dashboard."""
    if current_user.role != 'passenger':
        return redirect(url_for('routes.driver_dash'))
    return render_template('passenger.html')


@routes.route('/driver')
@login_required
def driver_dash():
    """Driver management dashboard."""
    if current_user.role != 'driver':
        return redirect(url_for('routes.passenger_dash'))
    return render_template('driver.html')


@routes.route('/api/geocode')
@login_required
def geocode():
    """Proxy OpenStreetMap Nominatim API for geocoding address queries."""
    query_str = request.args.get('q', '').strip()
    lat = request.args.get('lat')
    lng = request.args.get('lng')

    headers = {'User-Agent': 'CabExpress-App/1.0'}
    try:
        if query_str:
            encoded_q = urllib.parse.quote(query_str)
            url = f"https://nominatim.openstreetmap.org/search?format=json&q={encoded_q}&limit=5"
        else:
            url = f"https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat={lat}&lon={lng}"

        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=5) as response:
            return jsonify(json.loads(response.read().decode('utf-8')))
    except Exception as e:
        logger.error(f"Geocoding error: {e}")
        return jsonify([])


@routes.route('/api/request-ride', methods=['POST'])
@login_required
def request_ride():
    """Submit a new ride request."""
    if current_user.role != 'passenger':
        return jsonify({"error": "Unauthorized"}), 403

    payload = request.get_json(silent=True) or {}
    if not payload or 'pickup_lat' not in payload or 'dropoff_lat' not in payload:
        return jsonify({"error": "Invalid request parameters"}), 400

    pickup_lat = float(payload['pickup_lat'])
    pickup_lng = float(payload['pickup_lng'])
    dropoff_lat = float(payload['dropoff_lat'])
    dropoff_lng = float(payload['dropoff_lng'])

    dist_km = calculate_distance(pickup_lat, pickup_lng, dropoff_lat, dropoff_lng)
    total_fare = round(3.00 + (dist_km * 1.80), 2)
    verification_otp = str(random.randint(1000, 9999))

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO rides (passenger_id, passenger_name, pickup_address, pickup_lat, pickup_lng,
                                  dropoff_address, dropoff_lat, dropoff_lng, fare, otp)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (current_user.id, current_user.username, payload.get('pickup_address', ''),
             pickup_lat, pickup_lng, payload.get('dropoff_address', ''), dropoff_lat, dropoff_lng, total_fare, verification_otp)
        )
        ride_id = cursor.lastrowid
        conn.commit()

    return jsonify({"success": True, "ride_id": ride_id, "fare": total_fare, "dist": dist_km, "otp": verification_otp})


@routes.route('/api/pending-rides')
@login_required
def pending_rides():
    """Fetch pending ride requests for drivers."""
    if current_user.role != 'driver':
        return jsonify([])

    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM rides WHERE status = 'pending' ORDER BY id DESC")
        return jsonify([dict(row) for row in cursor.fetchall()])


@routes.route('/api/ride-status/<int:ride_id>')
@login_required
def ride_status(ride_id):
    """Retrieve details for a specific ride ID."""
    with get_db() as conn:
        ride = conn.execute("SELECT * FROM rides WHERE id = ?", (ride_id,)).fetchone()
        if ride:
            return jsonify(dict(ride))
        return jsonify({"error": "Ride not found"}), 404


@routes.route('/api/accept-ride/<int:ride_id>', methods=['POST'])
@login_required
def accept_ride(ride_id):
    """Accept a pending ride request."""
    if current_user.role != 'driver':
        return jsonify({"error": "Unauthorized"}), 403

    with get_db() as conn:
        ride = conn.execute("SELECT * FROM rides WHERE id = ?", (ride_id,)).fetchone()
        if ride and ride['status'] == 'pending':
            conn.execute(
                "UPDATE rides SET status = 'accepted', driver_id = ?, driver_name = ?, driver_lat = ?, driver_lng = ? WHERE id = ?",
                (current_user.id, current_user.username, ride['pickup_lat'] - 0.003, ride['pickup_lng'] - 0.003, ride_id)
            )
            conn.commit()
            return jsonify({"success": True})
    return jsonify({"error": "Failed to accept ride"}), 400


@routes.route('/api/verify-otp/<int:ride_id>', methods=['POST'])
@login_required
def verify_otp(ride_id):
    """Verify passenger OTP before starting trip."""
    if current_user.role != 'driver':
        return jsonify({"error": "Unauthorized"}), 403

    payload = request.get_json(silent=True) or {}
    submitted_otp = str(payload.get('otp', '')).strip()

    with get_db() as conn:
        ride = conn.execute("SELECT * FROM rides WHERE id = ?", (ride_id,)).fetchone()
        if ride and ride['otp'] == submitted_otp:
            conn.execute("UPDATE rides SET status = 'in_progress' WHERE id = ?", (ride_id,))
            conn.commit()
            return jsonify({"success": True})
    return jsonify({"success": False, "error": "Invalid OTP code"}), 400


@routes.route('/api/submit-rating/<int:ride_id>', methods=['POST'])
@login_required
def submit_rating(ride_id):
    """Submit passenger star rating."""
    payload = request.get_json(silent=True) or {}
    rating_val = int(payload.get('rating', 5))

    with get_db() as conn:
        conn.execute("UPDATE rides SET rating = ? WHERE id = ? AND passenger_id = ?", (rating_val, ride_id, current_user.id))
        conn.commit()
    return jsonify({"success": True})


@routes.route('/api/cancel-ride/<int:ride_id>', methods=['POST'])
@login_required
def cancel_ride(ride_id):
    """Cancel a pending ride request."""
    with get_db() as conn:
        conn.execute("UPDATE rides SET status = 'cancelled' WHERE id = ? AND passenger_id = ? AND status = 'pending'", (ride_id, current_user.id))
        conn.commit()
    return jsonify({"success": True})


@routes.route('/api/update-progress/<int:ride_id>', methods=['POST'])
@login_required
def update_progress(ride_id):
    """Update driver position and status during simulation."""
    if current_user.role != 'driver':
        return jsonify({"error": "Unauthorized"}), 403

    payload = request.get_json(silent=True) or {}
    if 'driver_lat' not in payload or 'driver_lng' not in payload:
        return jsonify({"error": "Invalid payload"}), 400

    with get_db() as conn:
        conn.execute(
            "UPDATE rides SET status = ?, driver_lat = ?, driver_lng = ? WHERE id = ? AND driver_id = ?",
            (payload.get('status', 'in_progress'), payload['driver_lat'], payload['driver_lng'], ride_id, current_user.id)
        )
        conn.commit()
    return jsonify({"success": True})


@routes.route('/api/user-history')
@login_required
def user_history():
    """Fetch trip history and summary metrics for the logged-in user."""
    with get_db() as conn:
        if current_user.role == 'driver':
            history = [dict(r) for r in conn.execute("SELECT * FROM rides WHERE driver_id = ? ORDER BY id DESC", (current_user.id,)).fetchall()]
            earnings = conn.execute("SELECT SUM(fare) as total FROM rides WHERE driver_id = ? AND status = 'completed'", (current_user.id,)).fetchone()['total'] or 0.0
            rating = conn.execute("SELECT AVG(rating) as avg FROM rides WHERE driver_id = ? AND rating IS NOT NULL", (current_user.id,)).fetchone()['avg'] or 5.0
            return jsonify({"history": history, "earnings": round(earnings, 2), "rating": round(rating, 1)})
        else:
            history = [dict(r) for r in conn.execute("SELECT * FROM rides WHERE passenger_id = ? ORDER BY id DESC", (current_user.id,)).fetchall()]
            return jsonify({"history": history})


@routes.route('/api/reset-demo', methods=['POST'])
@login_required
def reset_demo():
    """Clear all test ride data."""
    with get_db() as conn:
        conn.execute("DELETE FROM rides")
        conn.commit()
    return jsonify({"success": True})
