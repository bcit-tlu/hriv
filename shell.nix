{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    # Frontend
    nodejs_24

    # Backend
    python3
    poetry

    # Kubernetes / deployment
    kubectl
    kubernetes-helm
    fluxcd
    kubectx
    kustomize
    krew

    # Utilities
    git
    gh
    jq
    nixd
  ];
}
