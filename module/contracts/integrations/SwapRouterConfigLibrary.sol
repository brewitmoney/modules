// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

library SwapRouterConfigLibrary {
    struct RouterConfig {
        address payable routerAddress;
        uint24 fee;
    }

    // Define configurations inside a pure function
    function getSwapRouterConfig(uint256 chainId) internal pure returns (RouterConfig memory) {
        if (chainId == 1) { // Ethereum Mainnet
            return RouterConfig(payable(0xE592427A0AEce92De3Edee1F18E0157C05861564), 3000);
        } else if (chainId == 137) { // Polygon
            return RouterConfig(payable(0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45), 3000);
        } else if (chainId == 42161) { // Arbitrum
            return RouterConfig(payable(0xE592427A0AEce92De3Edee1F18E0157C05861564), 500);
        } else if (chainId == 8453) { // Base
            return RouterConfig(payable(0x2626664c2603336E57B271c5C0b26F421741e481), 3000);
        } else {
            return RouterConfig(payable(0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45), 3000);
        }
    }
}