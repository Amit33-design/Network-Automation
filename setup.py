from setuptools import setup, find_packages

setup(
    name="network-scanner",
    version="1.0.0",
    description="Network port scanner: TCP, UDP, HTTP, HTTPS across network segments",
    packages=find_packages(),
    python_requires=">=3.8",
    install_requires=[
        "netifaces>=0.11.0",
    ],
    extras_require={
        "dev": ["pytest", "pytest-cov"],
    },
    entry_points={
        "console_scripts": [
            "netscan=network_scanner.cli:main",
        ],
    },
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Topic :: System :: Networking",
        "Environment :: Console",
    ],
)
