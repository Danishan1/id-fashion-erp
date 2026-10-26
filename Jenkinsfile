pipeline {
    agent any

    options {
        // Never let two deploys run migrations against the same database at once.
        disableConcurrentBuilds()
    }

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
                    npx prisma validate
                    npx prisma generate
                '''
            }
        }

        stage('Migration Checks') {
            // Catches migration problems BEFORE anything touches the database:
            // edited (already-applied) migrations, empty/missing migration.sql,
            // and the known sample_requests.color drift line.
            steps {
                sh '''
                    set -eu
                    node scripts/check-migrations.mjs
                '''
            }
        }

        stage('Unit Tests') {
            // Unit tests mock the database. They must never reach the real one,
            // so DATABASE_URL points nowhere here, and every *_IT_DATABASE_URL
            // is removed so the DB integration tests skip themselves.
            steps {
                sh '''
                    set -eu
                    env -u HRMS_IT_DATABASE_URL -u CRM_IT_DATABASE_URL -u BULK_IT_DATABASE_URL -u BULK_IT_REDIS_URL \
                        DATABASE_URL="postgresql://ci:ci@127.0.0.1:1/no_database_in_unit_tests" \
                        npm test
                '''
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

        stage('Production Database Migration') {
            // Runs from the build workspace (its .env is the production one),
            // after the build succeeded and BEFORE the new files go live, so
            // new code never starts against an old database.
            steps {
                sh '''
                    set -eu

                    echo "Pending migrations (informational):"
                    npx prisma migrate status || true

                    echo "Applying pending production migrations..."
                    if ! npx prisma migrate deploy; then
                        echo ""
                        echo "MIGRATION FAILED - the live app was NOT changed (files not deployed, app not restarted)."
                        echo "See docs/DEPLOYMENT_MIGRATIONS.md -> 'A migration failed on the server'."
                        exit 1
                    fi

                    echo "Syncing the permission catalog..."
                    node --experimental-strip-types --no-warnings scripts/sync-permission-catalog.mjs

                    echo "Database migrations completed."
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

        stage('Restart Application') {
            steps {
                sh '''
                    set -eu

                    cd "$DEPLOY_DIR"

                    echo "Restarting Fashion ERP..."
                    PORT=3007 pm2 restart fashion-erp-web --update-env

                    # Restart the background worker too, if it runs under pm2.
                    if pm2 describe fashion-erp-worker >/dev/null 2>&1; then
                        pm2 restart fashion-erp-worker --update-env
                    fi

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
