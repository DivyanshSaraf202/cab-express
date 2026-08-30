from flask import Flask
from flask_login import LoginManager
from config import Config
from .database import init_db, User
from .routes import routes

def create_app():
    
    app = Flask(__name__, template_folder='../templates', static_folder='../static')
    
    app.config.from_object(Config)

    init_db(app.config['DATABASE_PATH'])

    login_manager = LoginManager()
    login_manager.login_view = 'routes.auth'
    login_manager.login_message_category = 'info'
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(user_id):
        """User loader callback invoked by Flask-Login on every request."""
        return User.get_by_id(user_id, app.config['DATABASE_PATH'])

    app.register_blueprint(routes)

    return app

app = create_app()
