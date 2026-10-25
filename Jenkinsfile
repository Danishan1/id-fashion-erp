
pipeline {
    agent any

    environment {
        PATH = "/var/lib/jenkins/.nvm/versions/node/v22.23.2/bin:${env.PATH}"
        DEPLOY_DIR = "/var/www/html/NodeProjects/fashion-erp"
    }

    stages {

        stage('Setup Environment') {
            steps {
                withCredentials([
                    file(
                        credentialsId: 'fashion-erp-env-global',
                        variable: 'ENV_FILE'
                    )
                ]) {
                    sh '''
                        set -eu
                        cp "$ENV_FILE" .env
                        chmod 600 .env
                    '''
                }
            }
        }

        stage('Install Dependencies') {
            steps {
                sh '''
                    set -eu
                    node -v
                    npm -v
                    npm ci
                '''
            }
        }

        stage('Prisma Generate') {
            steps {
                sh '''
                    set -eu
                    npx prisma generate
                '''
            }
        }

        stage('Test') {
            steps {
                // Create this Jenkins Secret File credential first.
                // It must contain a SEPARATE TEST DATABASE URL.
                withCredentials([
                    file(
                        credentialsId: 'fashion-erp-test-env',
                        variable: 'TEST_ENV_FILE'
                    )
                ]) {
                    sh '''
                        set -eu

                        BACKUP_ENV="$(mktemp)"
                        cp .env "$BACKUP_ENV"

                        restore_env() {
                            cp "$BACKUP_ENV" .env
                            rm -f "$BACKUP_ENV"
                        }
                        trap restore_env EXIT

                        cp "$TEST_ENV_FILE" .env
                        echo "Running tests against the test database..."
                        npm test
                    '''
                }
            }
        }

        stage('Build') {
            steps {
                sh '''
                    set -eu
                    npm run build
                '''
            }
        }

        stage('Deploy Files') {
            steps {
                withCredentials([
                    file(
                        credentialsId: 'fashion-erp-env-global',
                        variable: 'ENV_FILE'
                    )
                ]) {
                    sh '''
                        set -eu

                        echo "Deploying Fashion ERP files..."

                        mkdir -p "$DEPLOY_DIR"

                        rsync -a --delete \
                            --exclude='.env' \
                            --exclude='uploads/' \
                            ./ "$DEPLOY_DIR/"

                        cp "$ENV_FILE" "$DEPLOY_DIR/.env"
                        chmod 600 "$DEPLOY_DIR/.env"

                        mkdir -p "$DEPLOY_DIR/uploads"

                        echo "Deployment files copied."
                    '''
                }
            }
        }

        stage('Production Database Migration') {
            steps {
                withCredentials([
                    file(
                        credentialsId: 'fashion-erp-env-global',
                        variable: 'ENV_FILE'
                    )
                ]) {
                    sh '''
                        set -eu

                        cd "$DEPLOY_DIR"

                        cp "$ENV_FILE" .env
                        chmod 600 .env

                        echo "Checking Prisma migration status..."
                        npx prisma migrate status

                        echo "Applying pending production migrations..."
                        npx prisma migrate deploy

                        echo "Database migrations completed."
                    '''
                }
            }
        }

        stage('Restart Application') {
            steps {
                sh '''
                    set -eu

                    cd "$DEPLOY_DIR"

                    export PATH="/var/lib/jenkins/.nvm/versions/node/v22.23.2/bin:$PATH"

                    echo "Restarting Fashion ERP..."
                    PORT=3007 pm2 restart fashion-erp-web --update-env

                    pm2 save

                    echo "Fashion ERP deployed successfully."
                '''
            }
        }
    }

    post {
        success {
            echo 'Fashion ERP build, migration and deployment successful!'
        }

        failure {
            echo 'Fashion ERP pipeline failed. Check the failed stage in Jenkins.'
        }

        always {
            sh 'rm -f .env || true'
        }
    }
}
