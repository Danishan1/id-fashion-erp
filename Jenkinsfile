pipeline {
    agent any

    environment {
        PATH = "/var/lib/jenkins/.nvm/versions/node/v22.23.2/bin:${env.PATH}"
    }

    stages {

        stage('Setup Environment') {
            steps {
                withCredentials([file(credentialsId: 'fashion-erp-env-global', variable: 'ENV_FILE')]) {
                    sh 'cp "$ENV_FILE" .env'
                }
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'node -v'
                sh 'npm -v'
                sh 'npm ci'
            }
        }

        stage('Prisma Generate') {
            steps {
                sh 'npx prisma generate'
            }
        }

        stage('Test') {
            steps {
                sh 'npm test'
            }
        }

        stage('Build') {
            steps {
                sh 'npm run build'
            }
        }

        stage('Deploy') {
            steps {
                withCredentials([file(credentialsId: 'fashion-erp-env-global', variable: 'ENV_FILE')]) {
                    sh '''
                        DEPLOY_DIR="/var/www/html/NodeProjects/fashion-erp"

                        echo "Deploying Fashion ERP..."

                        rsync -a --delete \
                        --exclude='.env' \
                        --exclude='uploads/' \
                        ./ "$DEPLOY_DIR/"

                        cp "$ENV_FILE" "$DEPLOY_DIR/.env"
                        chmod 600 "$DEPLOY_DIR/.env"

                        mkdir -p "$DEPLOY_DIR/uploads"

                        echo "Restarting Fashion ERP..."

                        export PATH="/var/lib/jenkins/.nvm/versions/node/v22.23.2/bin:$PATH"

                        cd "$DEPLOY_DIR"

                        PORT=3007 pm2 restart fashion-erp-web --update-env

                        pm2 save

                        echo "Fashion ERP deployed successfully."
                    '''
                }
            }
        }
    }

    post {
        success {
            echo 'Fashion ERP build and deployment successful!'
        }

        failure {
            echo 'Fashion ERP build or deployment failed!'
        }

        always {
            sh 'rm -f .env'
        }
    }
}