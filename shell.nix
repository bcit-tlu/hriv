{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    # Frontend
    nodejs_22

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
    jq
    nixd
  ];
}
