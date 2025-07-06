# Multi-Environment Fintech App Deployment Using Docker & Kubernetes
Mini-InstaPay is a digital money transfer platform designed to enable users to securely send and receive money instantly. The system supports key features such as account registration, login, balance management, transaction history tracking, and basic reporting. It aims to provide a fast, user-friendly experience while ensuring transaction integrity and safety. To achieve availability, scalability, maintainability, and efficient deployment, Mini-InstaPay leverages modern DevOps tools, including Docker, Docker-Compose, and Kubernetes.

Key project highlights:

Dockerized Microservices: Each core service (auth, transactions, reporting, frontend, etc.) was containerized using custom Docker images for Node.js and Python.

Three Environment Setup: Built and managed development, staging, and production environments using docker-compose and environment-specific override files.

Kubernetes Orchestration: Used Kubernetes (Minikube) to deploy and manage the production environment, including Deployments, Services, ConfigMaps, Secrets, and StatefulSets for persistent DB.

Monitoring & Alerts: Deployed Prometheus and Grafana via Helm charts for real-time performance monitoring and created custom alerting rules for node-level resource pressure.

Scalability & Availability: Ensured reliability by replicating services, isolating environments, and supporting dynamic scaling using Kubernetes.
